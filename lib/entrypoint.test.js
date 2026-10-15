import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'

// Exercise the same template substitution used when packaging the deployed app.
const directory = await mkdtemp(path.join(tmpdir(), 'scandium-entrypoint-'))
after(() => rm(directory, { recursive: true, force: true }))
const source = await readFile(new URL('../entrypoint.js', import.meta.url), 'utf8')
await writeFile(path.join(directory, 'entrypoint.mjs'), source.replace('{{MAIN_FILE}}', './app.mjs'))
await writeFile(path.join(directory, 'app.mjs'), `
import http from 'node:http'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)
  if (req.url === '/binary') {
    res.setHeader('content-type', 'image/png')
    res.end(Buffer.from([0, 255, 128, 1]))
    return
  }
  if (req.url === '/compressed') {
    res.setHeader('content-type', 'text/plain')
    res.setHeader('content-encoding', 'gzip')
    res.end(gzipSync('hello'))
    return
  }
  if (req.url === '/empty') {
    res.statusCode = 204
    res.end()
    return
  }
  res.statusCode = 201
  res.setHeader('content-type', 'application/json')
  res.setHeader('set-cookie', req.url === '/single-cookie'
    ? 'session=abc; HttpOnly'
    : ['session=abc; Expires=Wed, 21 Oct 2030 07:28:00 GMT', 'theme=dark; Secure'])
  res.setHeader('vary', ['Accept', 'Origin'])
  res.setHeader('x-number', 42)
  res.end(JSON.stringify({
    method: req.method, url: req.url, headers: req.headers, rawHeaders: req.rawHeaders,
    ip: req.socket.remoteAddress, family: req.socket.remoteFamily,
    encrypted: req.socket.encrypted, length: body.length,
    sha256: createHash('sha256').update(body).digest('hex')
  }))
}).listen(8080)
`)

const originalListen = http.Server.prototype.listen
let handler
try {
  const entrypoint = await import(pathToFileURL(path.join(directory, 'entrypoint.mjs')))
  handler = entrypoint.handler
} finally {
  http.Server.prototype.listen = originalListen
}

function functionUrl (overrides = {}) {
  return {
    version: '2.0',
    rawPath: '/',
    rawQueryString: '',
    headers: { host: 'example.lambda-url.eu-north-1.on.aws' },
    requestContext: { http: { method: 'GET', sourceIp: '203.0.113.42', protocol: 'HTTP/1.1' } },
    isBase64Encoded: false,
    ...overrides
  }
}

function responseBody (response) {
  return Buffer.from(response.body, response.isBase64Encoded ? 'base64' : 'utf8')
}

const cookies = ['session=abc; Expires=Wed, 21 Oct 2030 07:28:00 GMT', 'theme=dark; Secure']

test('Function URL preserves raw paths, query strings, headers, cookies and source IP', async () => {
  const context = {}
  const result = await handler(functionUrl({
    rawPath: '/a%2Fb',
    rawQueryString: 'tag=a&tag=b&name=a%2Bb&space=a+b&empty=',
    queryStringParameters: { tag: 'a,b' },
    cookies: ['session=abc', 'theme=dark'],
    headers: { host: 'example.lambda-url.eu-north-1.on.aws', authorization: 'Bearer token', 'x-values': 'one,two' }
  }), context)
  const request = JSON.parse(result.body)
  assert.equal(request.url, '/a%2Fb?tag=a&tag=b&name=a%2Bb&space=a+b&empty=')
  assert.equal(request.method, 'GET')
  assert.equal(request.headers.cookie, 'session=abc; theme=dark')
  assert.ok(request.rawHeaders.includes('session=abc; theme=dark'))
  assert.equal(request.headers.authorization, 'Bearer token')
  assert.equal(request.headers['x-values'], 'one,two')
  assert.equal(request.headers.host, 'example.lambda-url.eu-north-1.on.aws')
  assert.equal(request.ip, '203.0.113.42')
  assert.equal(request.family, 'IPv4')
  assert.equal(request.encrypted, true)
  assert.equal(context.callbackWaitsForEmptyEventLoop, false)
  assert.equal(result.statusCode, 201)
  assert.equal(result.isBase64Encoded, false)
  assert.deepEqual(result.cookies, cookies)
  assert.equal(result.headers['set-cookie'], undefined)
  assert.equal(result.headers.vary, 'Accept,Origin')
  assert.equal(result.headers['x-number'], '42')
  assert.equal(result.multiValueHeaders, undefined)
})

test('Function URL accepts IPv6 and preserves forwarded headers', async () => {
  const result = await handler(functionUrl({
    requestContext: { http: { method: 'OPTIONS', sourceIp: '2001:db8::1' } },
    headers: { origin: 'https://example.com', 'x-forwarded-for': '192.0.2.1', 'x-forwarded-proto': 'https' }
  }), {})
  const request = JSON.parse(result.body)
  assert.equal(request.ip, '2001:db8::1')
  assert.equal(request.family, 'IPv6')
  assert.equal(request.method, 'OPTIONS')
  assert.equal(request.headers.origin, 'https://example.com')
  assert.equal(request.headers['x-forwarded-for'], '192.0.2.1')
})

test('Function URL preserves a 2 MiB binary upload and UTF-8 body bytes', async () => {
  for (const [body, encoded] of [[Buffer.alloc(2 * 1024 * 1024, 0xa5), true], [Buffer.from('Hello, världen 🌍'), false]]) {
    const result = await handler(functionUrl({
      requestContext: { http: { method: 'POST', sourceIp: '203.0.113.42' } },
      body: body.toString(encoded ? 'base64' : 'utf8'),
      isBase64Encoded: encoded
    }), {})
    const request = JSON.parse(result.body)
    assert.equal(request.method, 'POST')
    assert.equal(request.length, body.length)
    assert.equal(request.headers['content-length'], String(body.length))
    assert.equal(request.sha256, createHash('sha256').update(body).digest('hex'))
  }
})

test('Function URL encodes binary and compressed responses', async () => {
  const binary = await handler(functionUrl({ rawPath: '/binary' }), {})
  assert.equal(binary.isBase64Encoded, true)
  assert.deepEqual(responseBody(binary), Buffer.from([0, 255, 128, 1]))
  assert.equal(binary.cookies, undefined)
  const compressed = await handler(functionUrl({ rawPath: '/compressed' }), {})
  assert.equal(compressed.isBase64Encoded, true)
  const { gunzipSync } = await import('node:zlib')
  assert.equal(gunzipSync(responseBody(compressed)).toString(), 'hello')
})

test('Function URL handles single cookies, missing cookies and empty responses', async () => {
  const single = await handler(functionUrl({ rawPath: '/single-cookie', cookies: [] }), {})
  assert.deepEqual(single.cookies, ['session=abc; HttpOnly'])
  assert.equal(JSON.parse(single.body).headers.cookie, undefined)
  const empty = await handler(functionUrl({ rawPath: '/empty' }), {})
  assert.equal(empty.statusCode, 204)
  assert.equal(empty.body, '')
  assert.equal(empty.multiValueHeaders, undefined)
})

test('API Gateway v1 retains multi-value responses and identity source IP', async () => {
  const result = await handler({
    httpMethod: 'GET',
    path: '/legacy',
    queryStringParameters: { name: 'a+b' },
    headers: { cookie: 'session=legacy' },
    requestContext: { identity: { sourceIp: '192.0.2.1' } }
  }, {})
  const request = JSON.parse(result.body)
  assert.equal(request.url, '/legacy?name=a%2Bb')
  assert.equal(request.ip, '192.0.2.1')
  assert.equal(request.headers.cookie, 'session=legacy')
  assert.deepEqual(result.multiValueHeaders['set-cookie'], cookies)
  assert.deepEqual(result.multiValueHeaders.vary, ['Accept', 'Origin'])
  assert.equal(result.cookies, undefined)
})

test('ALB retains multi-value request and response conversion', async () => {
  const result = await handler({
    httpMethod: 'GET',
    path: '/legacy',
    multiValueQueryStringParameters: { tag: ['a%2Bb', 'c'] },
    multiValueHeaders: { cookie: ['session=legacy', 'theme=dark'], 'x-values': ['one', 'two'] },
    requestContext: { elb: { targetGroupArn: 'arn:aws:elasticloadbalancing:example' } }
  }, {})
  const request = JSON.parse(result.body)
  assert.equal(request.url, '/legacy?tag=a%2Bb&tag=c')
  assert.equal(request.headers.cookie, 'session=legacy; theme=dark')
  assert.equal(request.headers['x-values'], 'one, two')
  assert.equal(request.ip, '127.0.0.1')
  assert.deepEqual(result.multiValueHeaders['set-cookie'], cookies)
  assert.deepEqual(result.multiValueHeaders['content-type'], ['application/json'])
  assert.equal(result.headers, undefined)
  assert.equal(result.cookies, undefined)
})

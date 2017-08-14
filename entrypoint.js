const net = require('net')
const url = require('url')
const http = require('http')
const stream = require('stream')

const kChunks = Symbol('chunks')
const kCallback = Symbol('callback')

class LambdaSocket extends stream.Duplex {
  constructor (event) {
    super()

    const sourceIp = event.requestContext.identity.sourceIp
    const sourceFamily = net.isIPv6(sourceIp) ? 'IPv6' : 'IPv4'

    this.bufferSize = 0
    this.bytesRead = 0
    this.bytesWritten = 0
    this.connecting = false
    this.destroyed = false
    this.encrypted = true
    this.localAddress = '127.0.0.1'
    this.localPort = 80
    this.readable = false
    this.remoteAddress = sourceIp
    this.remoteFamily = sourceFamily
    this.remotePort = 80
  }

  address () {
    return { port: this.localPort, family: 'IPv4', address: this.localAddress }
  }

  connect () {
    throw new Error('Cannot connect this socket')
  }

  // Nothing to destroy
  destroy () {}

  // Discard all data, it's handled elsewhere
  _write (chunk, encoding, next) { next() }

  // This stream will start ended
  _read () {}
}

class LambdaRequest extends http.IncomingMessage {
  constructor (socket, event) {
    super(socket)

    for (const key of Object.keys(event.headers)) {
      this.headers[key.toLowerCase()] = event.headers[key]
    }

    this.httpVersionMajor = '1'
    this.httpVersionMinor = '1'
    this.httpVersion = '1.1'
    this.complete = true

    this.url = url.format({ pathname: event.path, query: event.queryStringParameters })
    this.method = event.httpMethod

    const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : ''

    if (body) {
      this.push(body)
    }

    this.push(null)
  }
}

class LambdaResponse extends http.ServerResponse {
  constructor (socket, request, cb) {
    super(request)

    this[kChunks] = []
    this[kCallback] = cb

    this.assignSocket(socket)

    this.write = LambdaResponse.prototype.write
    this.end = LambdaResponse.prototype.end
  }

  write (chunk) {
    if (typeof chunk === 'string') {
      chunk = Buffer.from(chunk)
    }

    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('Invalid non-string/buffer chunk')
    }

    this[kChunks].push(chunk)
  }

  end (chunk) {
    if (chunk) this.write(chunk)

    const probablyText = Boolean(
      /^text\//.exec(this._headers['content-type']) ||
      /^application\/(dart|(java|ecma|post)script)/.exec(this._headers['content-type']) ||
      /^application\/(.+\+)?(json|xml)/.exec(this._headers['content-type'])
    )

    this[kCallback](null, {
      isBase64Encoded: !probablyText,
      statusCode: this.statusCode,
      headers: this._headers,
      body: Buffer.concat(this[kChunks]).toString(probablyText ? 'utf8' : 'base64')
    })
  }
}

const serverPromise = new Promise((resolve) => {
  let listenCalled = false

  http.Server.prototype.listen = function listen () {
    if (listenCalled) {
      throw new Error('`.listen()` can only be called once when running on Lambda')
    }

    listenCalled = true

    resolve(this)
  }
})

exports.handler = function (event, context, cb) {
  const socket = new LambdaSocket(event)
  const request = new LambdaRequest(socket, event)
  const response = new LambdaResponse(socket, request, cb)

  serverPromise.then((server) => server.emit('request', request, response))
}

// Start the actual app
require('./index')

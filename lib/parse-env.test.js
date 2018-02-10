const parseEnv = require('./parse-env.js')

test('Parses NODE_ENV=production', () => {
    expect(parseEnv('NODE_ENV=production')).toEqual({NODE_ENV: 'production'});
})

test('Parses [NODE_ENV=production, API=example.com]', () => {
    expect(parseEnv(['NODE_ENV=production', 'API=example.com'])).toEqual({NODE_ENV: 'production', API: 'example.com'});
})

test('Parses [NODE_ENV=production, API="example.com"]', () => {
    expect(parseEnv(['NODE_ENV=production', 'API=example.com'])).toEqual({NODE_ENV: 'production', API: 'example.com'});
})

test('Throws on invalid env', () => {
    expect(() => parseEnv(['NODE_ENV=', 'API=example.com'])).toThrow();
    expect(() => parseEnv(['=', 'API=example.com'])).toThrow();
    expect(() => parseEnv(['=aaa', 'API=example.com'])).toThrow();
    expect(() => parseEnv('API=')).toThrow();
    expect(() => parseEnv('')).toThrow();
    expect(() => parseEnv('API')).toThrow();
})
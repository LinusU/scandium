const KEY_VALUE_REGEX = /^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/

function parseEnv (env) {
    if (typeof env === 'undefined') {
        return {}
    }

    if (typeof env !== 'string') {
        throw new TypeError(`Got ${typeof env}, expected string`)
    }


    const match = env.match(KEY_VALUE_REGEX)

    if (!match) {
        throw new Error(`Unable to parse: ${env}`)
    }

    const [,key,value] = match

    if (value.length === 0) {
        throw new Error(`Env variable with key: ${key} has empty value`)
    }

    if (key.length === 0) {
        throw new Error(`Env variable with value: ${value} has no key`)
    }

    return { [key]: value }
}

module.exports = function (input) {
    if (Array.isArray(input)) {
        return Object.assign({}, ...input.map(parseEnv))
    }

    return parseEnv(input)
}
import parseArn from 'aws-arn-parser'
import { loadJsonFile } from 'load-json-file'
import { loadYamlFile } from 'load-yaml-file'

const BINARY_MEDIA_TYPES = [
  '*/*'
]

/**
 * Akamai's reasoning:
 *
 * > The reasons 860 bytes is the minimum size for compression is twofold: (1) The overhead of compressing an object under 860 bytes outweighs performance gain. (2) Objects under 860 bytes can be transmitted via a single packet anyway, so there isn't a compelling reason to compress them.
 *
 * ref: https://webmasters.stackexchange.com/q/31750/110031
 */
const MINIMUM_COMPRESSION_SIZE = 860

function integrationV1 (lambdaArn) {
  const { region } = parseArn(lambdaArn)

  return {
    responses: { default: { statusCode: '200' } },
    uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`,
    passthroughBehavior: 'when_no_match',
    httpMethod: 'POST',
    contentHandling: 'CONVERT_TO_TEXT',
    type: 'aws_proxy'
  }
}

export async function loadSwaggerFileV1 (filename, name, lambdaArn) {
  const packageInfo = await loadJsonFile('package.json')
  const definition = await loadYamlFile(filename)

  // This will be the name of the API Gateway, override whatever is in the yml file
  definition.info.title = name

  // eslint-disable-next-line no-template-curly-in-string
  if (definition.info.version === '${package.version}') definition.info.version = packageInfo.version

  for (const key of Object.keys(definition.paths)) {
    for (const method of Object.keys(definition.paths[key])) {
      definition.paths[key][method]['x-amazon-apigateway-integration'] = integrationV1(lambdaArn)
    }
  }

  if (!('x-amazon-apigateway-binary-media-types' in definition)) {
    definition['x-amazon-apigateway-binary-media-types'] = BINARY_MEDIA_TYPES
  }

  if (!('x-amazon-apigateway-minimum-compression-size' in definition)) {
    definition['x-amazon-apigateway-minimum-compression-size'] = MINIMUM_COMPRESSION_SIZE
  }

  return definition
}

export async function forwardAllDefinitionV1 (name, lambdaArn) {
  const packageInfo = await loadJsonFile('package.json')

  return {
    swagger: '2.0',
    info: {
      title: name,
      version: packageInfo.version
    },
    paths: {
      '/': {
        'x-amazon-apigateway-any-method': {
          'x-amazon-apigateway-integration': integrationV1(lambdaArn)
        }
      },
      '/{proxy+}': {
        'x-amazon-apigateway-any-method': {
          'x-amazon-apigateway-integration': integrationV1(lambdaArn)
        }
      }
    },
    'x-amazon-apigateway-binary-media-types': BINARY_MEDIA_TYPES,
    'x-amazon-apigateway-minimum-compression-size': MINIMUM_COMPRESSION_SIZE
  }
}

function integrationV2 (lambdaArn) {
  const { region } = parseArn(lambdaArn)

  return {
    httpMethod: 'POST',
    payloadFormatVersion: '1.0',
    type: 'AWS_PROXY',
    uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`
  }
}

export async function loadSwaggerFileV2 (filename, name, lambdaArn) {
  const packageInfo = await loadJsonFile('package.json')
  const definition = await loadYamlFile(filename)

  // This will be the name of the API Gateway, override whatever is in the yml file
  definition.info.title = name

  // eslint-disable-next-line no-template-curly-in-string
  if (definition.info.version === '${package.version}') definition.info.version = packageInfo.version

  for (const key of Object.keys(definition.paths)) {
    for (const method of Object.keys(definition.paths[key])) {
      definition.paths[key][method]['x-amazon-apigateway-integration'] = integrationV2(lambdaArn)
    }
  }

  if (!('x-amazon-apigateway-binary-media-types' in definition)) {
    definition['x-amazon-apigateway-binary-media-types'] = BINARY_MEDIA_TYPES
  }

  if (!('x-amazon-apigateway-minimum-compression-size' in definition)) {
    definition['x-amazon-apigateway-minimum-compression-size'] = MINIMUM_COMPRESSION_SIZE
  }

  return definition
}

export async function forwardAllDefinitionV2 (name, lambdaArn) {
  const packageInfo = await loadJsonFile('package.json')

  return {
    openapi: '3.0.0',
    info: {
      title: name,
      version: packageInfo.version
    },
    paths: {
      '/': {
        'x-amazon-apigateway-any-method': {
          'x-amazon-apigateway-integration': integrationV2(lambdaArn)
        }
      },
      '/{proxy+}': {
        'x-amazon-apigateway-any-method': {
          'x-amazon-apigateway-integration': integrationV2(lambdaArn)
        }
      }
    },
    'x-amazon-apigateway-binary-media-types': BINARY_MEDIA_TYPES,
    'x-amazon-apigateway-minimum-compression-size': MINIMUM_COMPRESSION_SIZE
  }
}

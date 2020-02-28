const loadJsonFile = require('load-json-file')
const loadTomlFile = require('load-toml-file')
const loadYamlFile = require('load-yaml-file')
const parseArn = require('aws-arn-parser')

async function loadPackageInfo (runtime) {
  if (runtime === 'rust') {
    return (await loadTomlFile('Cargo.toml')).package
  } else {
    return loadJsonFile('package.json')
  }
}

function integration (lambdaArn) {
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

exports.loadSwaggerFile = async function (filename, name, lambdaArn, runtime) {
  const packageInfo = await loadPackageInfo(runtime)
  const definition = await loadYamlFile(filename)

  // This will be the name of the API Gateway, override whatever is in the yml file
  definition.info.title = name

  // eslint-disable-next-line no-template-curly-in-string
  if (definition.info.version === '${package.version}') definition.info.version = packageInfo.version

  for (const key of Object.keys(definition.paths)) {
    for (const method of Object.keys(definition.paths[key])) {
      definition.paths[key][method]['x-amazon-apigateway-integration'] = integration(lambdaArn)
    }
  }

  if (!('x-amazon-apigateway-binary-media-types' in definition)) {
    definition['x-amazon-apigateway-binary-media-types'] = ['*/*']
  }

  return definition
}

exports.forwardAllDefinition = async function (name, lambdaArn, runtime) {
  const packageInfo = await loadPackageInfo(runtime)

  return {
    swagger: '2.0',
    info: {
      title: name,
      version: packageInfo.version
    },
    paths: {
      '/': {
        'x-amazon-apigateway-any-method': {
          'x-amazon-apigateway-integration': integration(lambdaArn)
        }
      },
      '/{proxy+}': {
        'x-amazon-apigateway-any-method': {
          'x-amazon-apigateway-integration': integration(lambdaArn)
        }
      }
    },
    'x-amazon-apigateway-binary-media-types': [
      '*/*'
    ]
  }
}

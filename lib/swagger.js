const loadJsonFile = require('load-json-file')
const loadYamlFile = require('load-yaml-file')
const parseArn = require('aws-arn-parser')

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

exports.loadSwaggerFile = async function (filename, lambdaArn) {
  const packageInfo = await loadJsonFile('package.json')
  const definition = await loadYamlFile(filename)

  if (definition.info.title === `\${package.name}`) definition.info.title = packageInfo.name
  if (definition.info.version === `\${package.version}`) definition.info.version = packageInfo.version

  for (const key of Object.keys(definition.paths)) {
    for (const method of Object.keys(definition.paths[key])) {
      definition.paths[key][method]['x-amazon-apigateway-integration'] = integration(lambdaArn)
    }
  }

  return definition
}

exports.forwardAllDefinition = async function (lambdaArn) {
  const packageInfo = await loadJsonFile('package.json')

  return {
    swagger: '2.0',
    info: {
      title: packageInfo.name,
      version: packageInfo.version
    },
    paths: {
      '/{proxy+}': {
        'x-amazon-apigateway-any-method': {
          'x-amazon-apigateway-integration': integration(lambdaArn)
        }
      }
    }
  }
}

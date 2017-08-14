const Lambda = require('aws-sdk/clients/lambda')
const APIGateway = require('aws-sdk/clients/apigateway')
const parseArn = require('aws-arn-parser')
const shortid = require('shortid')

const lambda = new Lambda({ apiVersion: '2015-03-31' })
const apiGateway = new APIGateway({ apiVersion: '2015-07-09' })

const defaultParams = {
  MemorySize: 320,
  Timeout: 3,
  Runtime: 'nodejs6.10'
}

function addPermission ({ lambdaArn, restApiId }) {
  const { region, namespace } = parseArn(lambdaArn)

  const params = {
    Action: 'lambda:InvokeFunction',
    FunctionName: lambdaArn,
    Principal: 'apigateway.amazonaws.com',
    StatementId: `${shortid.generate()}-AllowExecutionFromAPIGateway`,
    SourceArn: `arn:aws:execute-api:${region}:${namespace}:${restApiId}/*/*/*`
  }

  return lambda.addPermission(params).promise()
}

exports.createFunction = function ({ zipFile, functionName, role }) {
  const params = {
    Code: { ZipFile: zipFile },
    FunctionName: functionName,
    Handler: 'scandium-entrypoint.handler',
    MemorySize: defaultParams.MemorySize,
    Publish: true,
    Role: role,
    Runtime: defaultParams.Runtime,
    Timeout: defaultParams.Timeout
  }

  return lambda.createFunction(params).promise()
}

exports.updateFunction = function ({ zipFile, functionName }) {
  const params = {
    FunctionName: functionName,
    Publish: true,
    ZipFile: zipFile
  }

  return lambda.updateFunctionCode(params).promise()
}

exports.createApiGateway = async function ({ definition, lambdaArn }) {
  const params = {
    body: JSON.stringify(definition),
    failOnWarnings: true
  }

  const result = await apiGateway.importRestApi(params).promise()

  await addPermission({ lambdaArn, restApiId: result.id })

  return result
}

exports.updateApiGateway = async function ({ id, definition, lambdaArn }) {
  const params = {
    body: JSON.stringify(definition),
    restApiId: id,
    failOnWarnings: true,
    mode: 'overwrite'
  }

  const result = await apiGateway.putRestApi(params).promise()

  await addPermission({ lambdaArn, restApiId: result.id })

  return result
}

exports.deployApiGateway = function ({ id, stage }) {
  const params = {
    restApiId: id,
    stageName: stage
  }

  return apiGateway.createDeployment(params).promise()
}

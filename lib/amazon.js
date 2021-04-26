const { APIGatewayClient, CreateDeploymentCommand, GetRestApisCommand, ImportRestApiCommand, PutRestApiCommand } = require('@aws-sdk/client-api-gateway')
const { AttachRolePolicyCommand, CreateRoleCommand, IAMClient } = require('@aws-sdk/client-iam')
const { AddPermissionCommand, CreateFunctionCommand, GetFunctionConfigurationCommand, InvokeCommand, LambdaClient, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand } = require('@aws-sdk/client-lambda')
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3')
const bytes = require('bytes')
const parseArn = require('aws-arn-parser')
const { nanoid } = require('nanoid')
const pRetry = require('p-retry')
const revHash = require('rev-hash')

const UserError = require('./user-error')

const lambda = new LambdaClient()
const apiGateway = new APIGatewayClient()
const iam = new IAMClient()
const s3 = new S3Client()

const MAX_LAMBDA_ZIP_SIZE = bytes.parse('50mb')
const MAX_S3_ZIP_SIZE = bytes.parse('100mb')

const defaultParams = {
  MemorySize: 320,
  Timeout: 3,
  Runtime: 'nodejs14.x'
}

function addPermission ({ lambdaArn, restApiId }) {
  const { region, namespace } = parseArn(lambdaArn)

  const params = {
    Action: 'lambda:InvokeFunction',
    FunctionName: lambdaArn,
    Principal: 'apigateway.amazonaws.com',
    StatementId: `${nanoid(8)}-AllowExecutionFromAPIGateway`,
    SourceArn: `arn:aws:execute-api:${region}:${namespace}:${restApiId}/*/*/*`
  }

  return lambda.send(new AddPermissionCommand(params))
}

exports.verifyCodeSize = function (zipFile, { usingS3 }) {
  const codeStorageName = (usingS3 ? 'S3' : 'Lambda')
  const fileSizeLimit = (usingS3 ? MAX_S3_ZIP_SIZE : MAX_LAMBDA_ZIP_SIZE)
  const hint = (usingS3 ? '' : ', use --bucket to use S3')

  if (zipFile.byteLength >= fileSizeLimit) throw new Error(`Code size exceeded, ${bytes.format(zipFile.byteLength)}, max zip size for ${codeStorageName} deployments is ${bytes.format(fileSizeLimit)}${hint}`)
}

exports.createFunction = function ({ code, functionName, handler, role, environment, onFailedAttempt }) {
  const params = {
    Code: code,
    Environment: (environment ? { Variables: environment } : undefined),
    FunctionName: functionName,
    Handler: handler,
    MemorySize: defaultParams.MemorySize,
    Publish: true,
    Role: role,
    Runtime: defaultParams.Runtime,
    Timeout: defaultParams.Timeout
  }

  return pRetry(() => lambda.send(new CreateFunctionCommand(params)), { minTimeout: 2000, factor: 3, retries: 5, onFailedAttempt }).then(res => res.FunctionArn)
}

function updateRuntime ({ functionName, handler }) {
  const params = {
    FunctionName: functionName,
    Handler: handler,
    Runtime: defaultParams.Runtime
  }

  return lambda.send(new UpdateFunctionConfigurationCommand(params)).then(res => res.FunctionArn)
}

exports.updateFunction = async function ({ code, functionName, handler }) {
  const params = {
    FunctionName: functionName,
    Publish: true,
    ...code
  }

  const result = await lambda.send(new UpdateFunctionCodeCommand(params))

  if (result.Runtime !== defaultParams.Runtime || result.Handler !== handler) {
    return updateRuntime({ functionName, handler })
  }

  return result.FunctionArn
}

exports.getFunctionEnvironment = function ({ functionName }) {
  const params = {
    FunctionName: functionName
  }

  return lambda.send(new GetFunctionConfigurationCommand(params)).then(res => (res.Environment && res.Environment.Variables) || {})
}

exports.updateFunctionEnvironment = function ({ functionName, environment }) {
  const params = {
    FunctionName: functionName,
    Environment: { Variables: environment }
  }

  return lambda.send(new UpdateFunctionConfigurationCommand(params)).then(res => res.FunctionArn)
}

exports.createApiGateway = async function ({ definition, lambdaArn }) {
  const params = {
    body: JSON.stringify(definition),
    failOnWarnings: true
  }

  const result = await apiGateway.send(new ImportRestApiCommand(params))

  await addPermission({ lambdaArn, restApiId: result.id })

  return result
}

exports.findApiGateway = async function (name) {
  const result = await apiGateway.send(new GetRestApisCommand({ limit: 500 }))

  if (result.items.length === 500) {
    throw new Error('Pagination not implemented yet')
  }

  const matches = result.items.filter(item => item.name === name)

  if (matches.length > 1) {
    throw new UserError(`Multiple API Gateways with the name "${name}" found, please use the --rest-api-id flag to specify which one to update.`)
  }

  if (matches.length < 1) {
    throw new UserError(`No API Gateway with the name "${name}" found, please use the --rest-api-id flag to specify which one to update.`)
  }

  return matches[0].id
}

exports.updateApiGateway = async function ({ id, definition, lambdaArn }) {
  const params = {
    body: JSON.stringify(definition),
    restApiId: id,
    failOnWarnings: true,
    mode: 'overwrite'
  }

  const result = await apiGateway.send(new PutRestApiCommand(params))

  await addPermission({ lambdaArn, restApiId: result.id })

  return result
}

exports.deployApiGateway = function ({ id, stage }) {
  const params = {
    restApiId: id,
    stageName: stage
  }

  return apiGateway.send(new CreateDeploymentCommand(params))
}

const assumeRolePolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: { Service: 'lambda.amazonaws.com' },
    Action: 'sts:AssumeRole'
  }]
})

exports.createLambdaRole = async function (name) {
  const createParams = {
    AssumeRolePolicyDocument: assumeRolePolicy,
    Path: '/',
    RoleName: name
  }

  const result = await iam.send(new CreateRoleCommand(createParams))

  const attachParams = {
    RoleName: name,
    PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
  }

  await iam.send(new AttachRolePolicyCommand(attachParams))

  // Give AWS some time to propagate the role
  await new Promise(resolve => setTimeout(resolve, 1500))

  return result.Role.Arn
}

exports.uploadToS3 = async function ({ zipFile, functionName, bucketName }) {
  const key = `${functionName}-${revHash(zipFile)}.zip`

  const params = {
    Body: zipFile,
    Bucket: bucketName,
    Key: key
  }

  await s3.send(new PutObjectCommand(params))

  return key
}

exports.invokeLambda = async function ({ functionName, payload }) {
  const params = {
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    LogType: 'Tail',
    Payload: JSON.stringify(payload)
  }

  const result = await lambda.send(new InvokeCommand(params))
  const log = Buffer.from(result.LogResult || '', 'base64').toString()

  function createError (msg) {
    return Object.assign(new Error(msg), { stack: `Error: ${msg}\n\n${log}` })
  }

  if (result.FunctionError === 'Unhandled') {
    throw createError('An unhandled error occured when invoking the Lambda, most likely the memory or time limit were hit')
  }

  if (result.FunctionError === 'Handled') {
    throw createError('An error occured when invoking the Lambda')
  }

  return { log }
}

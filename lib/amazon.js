import { APIGatewayClient, CreateDeploymentCommand as CreateDeploymentCommandV1, PutRestApiCommand } from '@aws-sdk/client-api-gateway'
import { ApiGatewayV2Client, CreateDeploymentCommand as CreateDeploymentCommandV2, CreateStageCommand, GetApisCommand, ImportApiCommand, ReimportApiCommand } from '@aws-sdk/client-apigatewayv2'
import { AttachRolePolicyCommand, CreateRoleCommand, IAMClient } from '@aws-sdk/client-iam'
import { AddPermissionCommand, CreateFunctionCommand, GetFunctionConfigurationCommand, InvokeCommand, LambdaClient, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import bytes from 'bytes'
import parseArn from 'aws-arn-parser'
import { nanoid } from 'nanoid'
import pRetry from 'p-retry'
import revHash from 'rev-hash'

import UserError from './user-error.js'

const lambda = new LambdaClient()
const apiGatewayV1 = new APIGatewayClient()
const apiGatewayV2 = new ApiGatewayV2Client()
const iam = new IAMClient()
const s3 = new S3Client()

const MAX_LAMBDA_ZIP_SIZE = bytes.parse('50mb')
const MAX_S3_ZIP_SIZE = bytes.parse('100mb')

const defaultParams = {
  MemorySize: 320,
  Timeout: 3,
  Runtime: 'nodejs16.x'
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

export function verifyCodeSize (zipFile, { usingS3 }) {
  const codeStorageName = (usingS3 ? 'S3' : 'Lambda')
  const fileSizeLimit = (usingS3 ? MAX_S3_ZIP_SIZE : MAX_LAMBDA_ZIP_SIZE)
  const hint = (usingS3 ? '' : ', use --bucket to use S3')

  if (zipFile.byteLength >= fileSizeLimit) throw new Error(`Code size exceeded, ${bytes.format(zipFile.byteLength)}, max zip size for ${codeStorageName} deployments is ${bytes.format(fileSizeLimit)}${hint}`)
}

export async function createFunction ({ code, functionName, handler, role, environment, onFailedAttempt }) {
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

  return (await pRetry(async () => await lambda.send(new CreateFunctionCommand(params)), { minTimeout: 2000, factor: 3, retries: 5, onFailedAttempt })).FunctionArn
}

async function updateRuntime ({ functionName, handler }) {
  const params = {
    FunctionName: functionName,
    Handler: handler,
    Runtime: defaultParams.Runtime
  }

  return (await lambda.send(new UpdateFunctionConfigurationCommand(params))).FunctionArn
}

export async function updateFunction ({ code, functionName, handler }) {
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

export async function getFunctionEnvironment ({ functionName }) {
  const params = {
    FunctionName: functionName
  }

  const result = await lambda.send(new GetFunctionConfigurationCommand(params))

  return (result.Environment && result.Environment.Variables) || {}
}

export async function updateFunctionEnvironment ({ functionName, environment }) {
  const params = {
    FunctionName: functionName,
    Environment: { Variables: environment }
  }

  return (await lambda.send(new UpdateFunctionConfigurationCommand(params))).FunctionArn
}

export async function createApiGateway ({ definition, lambdaArn }) {
  const params = {
    Body: JSON.stringify(definition),
    FailOnWarnings: true
  }

  const result = await apiGatewayV2.send(new ImportApiCommand(params))

  await addPermission({ lambdaArn, restApiId: result.ApiId })

  return result.ApiId
}

export async function findApiGateway (name) {
  const result = await apiGatewayV2.send(new GetApisCommand({ MaxResults: '500' }))

  if (result.Items.length === 500) {
    throw new Error('Pagination not implemented yet')
  }

  const matches = result.Items.filter(item => item.Name === name)

  if (matches.length > 1) {
    throw new UserError(`Multiple API Gateways with the name "${name}" found, please use the --rest-api-id flag to specify which one to update.`)
  }

  if (matches.length < 1) {
    throw new UserError(`No API Gateway with the name "${name}" found, please use the --rest-api-id flag to specify which one to update.`)
  }

  return matches[0].ApiId
}

export async function updateApiGatewayV1 ({ id, definition, lambdaArn }) {
  const params = {
    body: JSON.stringify(definition),
    restApiId: id,
    failOnWarnings: true,
    mode: 'overwrite'
  }

  const result = await apiGatewayV1.send(new PutRestApiCommand(params))

  await addPermission({ lambdaArn, restApiId: result.id })

  return result
}

export async function updateApiGatewayV2 ({ id, definition, lambdaArn }) {
  const params = {
    ApiId: id,
    Body: JSON.stringify(definition),
    FailOnWarnings: true
  }

  const result = await apiGatewayV2.send(new ReimportApiCommand(params))

  await addPermission({ lambdaArn, restApiId: result.ApiId })

  return result
}

export async function deployApiGatewayV1 ({ id, stage }) {
  const params = {
    restApiId: id,
    stageName: stage
  }

  return await apiGatewayV1.send(new CreateDeploymentCommandV1(params))
}

export async function deployApiGatewayV2 ({ id, stage }) {
  try {
    await apiGatewayV2.send(new CreateDeploymentCommandV2({ ApiId: id, StageName: stage }))
  } catch (originalError) {
    try {
      // Try creating the Stage first
      await apiGatewayV2.send(new CreateStageCommand({ ApiId: id, StageName: stage }))
      await apiGatewayV2.send(new CreateDeploymentCommandV2({ ApiId: id, StageName: stage }))
    } catch (_) {
      throw originalError
    }
  }
}

const assumeRolePolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: { Service: 'lambda.amazonaws.com' },
    Action: 'sts:AssumeRole'
  }]
})

export async function createLambdaRole (name) {
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

export async function uploadToS3 ({ zipFile, functionName, bucketName }) {
  const key = `${functionName}-${revHash(zipFile)}.zip`

  const params = {
    Body: zipFile,
    Bucket: bucketName,
    Key: key
  }

  await s3.send(new PutObjectCommand(params))

  return key
}

export async function invokeLambda ({ functionName, onFailedAttempt, payload }) {
  const params = {
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    LogType: 'Tail',
    Payload: JSON.stringify(payload)
  }

  const result = await pRetry(async () => await lambda.send(new InvokeCommand(params)), { minTimeout: 2000, factor: 3, retries: 5, onFailedAttempt })
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

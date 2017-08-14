#!/usr/bin/env node

const Lambda = require('aws-sdk/clients/lambda')
const APIGateway = require('aws-sdk/clients/apigateway')
const neodoc = require('neodoc')
const parseArn = require('aws-arn-parser')
const shortid = require('shortid')

const builder = require('./lib/builder')
const swagger = require('./lib/swagger')

const lambda = new Lambda({ apiVersion: '2015-03-31' })
const apiGateway = new APIGateway({ apiVersion: '2015-07-09' })

const usage = `
Scandium

Usage:
  scandium create <name> [--swagger=<swagger>] [--deploy] --role=<role>
  scandium update <name> [--swagger=<swagger>] [--deploy] --rest-api-id=<rest-api-id>

Options:
  <name>          Name of the Lambda function.
  --role          ARN of the IAM role that Lambda assumes when it executes your function.
  --swagger       Path to Swagger API definition used to configure AWS API Gateway.
  --rest-api-id   ID of the AWS API Gateway rest api to update (printed by the "create" command).
  --deploy        Deploy the API and make it callable from the Internet.
`

const defaultParams = {
  MemorySize: 320,
  Timeout: 3,
  Runtime: 'nodejs6.10'
}

function createFunction ({ zipFile, functionName, role }) {
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

function updateFunction ({ zipFile, functionName }) {
  const params = {
    FunctionName: functionName,
    Publish: true,
    ZipFile: zipFile
  }

  return lambda.updateFunctionCode(params).promise()
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

async function createApiGateway ({ definition, lambdaArn }) {
  const params = {
    body: JSON.stringify(definition),
    failOnWarnings: true
  }

  const result = await apiGateway.importRestApi(params).promise()

  await addPermission({ lambdaArn, restApiId: result.id })

  return result
}

async function updateApiGateway ({ id, definition, lambdaArn }) {
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

function deployApiGateway ({ id, stage }) {
  const params = {
    restApiId: id,
    stageName: stage
  }

  return apiGateway.createDeployment(params).promise()
}

async function main () {
  const args = neodoc.run(usage)

  if (args.create) {
    const zipFile = await builder.createZipFile(process.cwd())
    const result = await createFunction({ zipFile, functionName: args['<name>'], role: args['--role'] })

    const lambdaArn = result.FunctionArn

    console.log(`Created new Lambda function with ARN: ${lambdaArn}`)

    const definition = args['--swagger']
      ? await swagger.loadSwaggerFile(args['--swagger'], lambdaArn)
      : await swagger.forwardAllDefinition(lambdaArn)

    const { id } = await createApiGateway({ definition, lambdaArn })

    console.log(`Created new API Gateway with id: ${id}`)

    if (args['--deploy']) {
      const stage = 'prod'
      const { region } = parseArn(lambdaArn)

      await deployApiGateway({ id, stage })

      console.log(`Now serving live requests at: https://${id}.execute-api.${region}.amazonaws.com/${stage}`)
    }
  }

  if (args.update) {
    const zipFile = await builder.createZipFile(process.cwd())
    const result = await updateFunction({ zipFile, functionName: args['<name>'] })

    const lambdaArn = result.FunctionArn

    console.log(`Updated existing Lambda function with ARN: ${lambdaArn}`)

    const definition = args['--swagger']
      ? await swagger.loadSwaggerFile(args['--swagger'], lambdaArn)
      : await swagger.forwardAllDefinition(lambdaArn)

    const id = args['--rest-api-id']

    await updateApiGateway({ id, definition, lambdaArn })

    console.log(`Updated existing API Gateway with id: ${id}`)

    if (args['--deploy']) {
      const stage = 'prod'
      const { region } = parseArn(lambdaArn)

      await deployApiGateway({ id, stage })

      console.log(`Now serving live requests at: https://${id}.execute-api.${region}.amazonaws.com/${stage}`)
    }
  }
}

main().catch((err) => {
  process.exitCode = 1
  console.error(err.stack)
})

#!/usr/bin/env node

const neodoc = require('neodoc')
const parseArn = require('aws-arn-parser')

const amazon = require('./lib/amazon')
const builder = require('./lib/builder')
const swagger = require('./lib/swagger')

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

async function main () {
  const args = neodoc.run(usage)

  if (args.create) {
    const zipFile = await builder.createZipFile(process.cwd())
    const result = await amazon.createFunction({ zipFile, functionName: args['<name>'], role: args['--role'] })

    const lambdaArn = result.FunctionArn

    console.log(`Created new Lambda function with ARN: ${lambdaArn}`)

    const definition = args['--swagger']
      ? await swagger.loadSwaggerFile(args['--swagger'], lambdaArn)
      : await swagger.forwardAllDefinition(lambdaArn)

    const { id } = await amazon.createApiGateway({ definition, lambdaArn })

    console.log(`Created new API Gateway with id: ${id}`)

    if (args['--deploy']) {
      const stage = 'prod'
      const { region } = parseArn(lambdaArn)

      await amazon.deployApiGateway({ id, stage })

      console.log(`Now serving live requests at: https://${id}.execute-api.${region}.amazonaws.com/${stage}`)
    }
  }

  if (args.update) {
    const zipFile = await builder.createZipFile(process.cwd())
    const result = await amazon.updateFunction({ zipFile, functionName: args['<name>'] })

    const lambdaArn = result.FunctionArn

    console.log(`Updated existing Lambda function with ARN: ${lambdaArn}`)

    const definition = args['--swagger']
      ? await swagger.loadSwaggerFile(args['--swagger'], lambdaArn)
      : await swagger.forwardAllDefinition(lambdaArn)

    const id = args['--rest-api-id']

    await amazon.updateApiGateway({ id, definition, lambdaArn })

    console.log(`Updated existing API Gateway with id: ${id}`)

    if (args['--deploy']) {
      const stage = 'prod'
      const { region } = parseArn(lambdaArn)

      await amazon.deployApiGateway({ id, stage })

      console.log(`Now serving live requests at: https://${id}.execute-api.${region}.amazonaws.com/${stage}`)
    }
  }
}

main().catch((err) => {
  process.exitCode = 1
  console.error(err.stack)
})

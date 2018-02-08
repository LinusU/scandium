#!/usr/bin/env node

/* Make sure that AWS uses local config files, since this is a CLI util */
process.env.AWS_SDK_LOAD_CONFIG = 'true'

const ora = require('ora')
const neodoc = require('neodoc')
const parseArn = require('aws-arn-parser')
const prettyBytes = require('pretty-bytes')
const awsHasRegion = require('aws-has-region')

const amazon = require('./lib/amazon')
const builder = require('./lib/builder')
const swagger = require('./lib/swagger')

class UserError extends Error {}

const usage = `
Scandium

Usage:
  scandium create <name> [--swagger=<swagger>] [--deploy-to=<stage>] [--role=<role>]
  scandium update <name> [--swagger=<swagger>] [--deploy-to=<stage>] --rest-api-id=<rest-api-id>

Options:
  <name>          Name of the Lambda function.
  --role          ARN of the IAM role that Lambda assumes when it executes your function.
  --swagger       Path to Swagger API definition used to configure AWS API Gateway.
  --rest-api-id   ID of the AWS API Gateway rest api to update (printed by the "create" command).
  --deploy-to     Deploy the API to the specified stage, and make it callable from the Internet.
`

async function main () {
  const args = neodoc.run(usage)
  const spinner = ora()

  if (!awsHasRegion()) {
    throw new UserError(awsHasRegion.errorText)
  }

  try {
    if (args.create) {
      spinner.start('Packaging app for Lambda')
      const zipFile = await builder.createZipFile(process.cwd())
      spinner.succeed(`App packaged successfully! Final size: ${prettyBytes(zipFile.byteLength)}`)

      let roleArn = args['--role']
      if (!roleArn) {
        spinner.start('Creating Lambda role')
        roleArn = await amazon.createLambdaRole(args['<name>'])
        spinner.succeed(`Created new Lambda role with ARN: ${roleArn}`)
      }

      spinner.start('Creating Lambda function')
      const lambdaArn = await amazon.createFunction({ zipFile, functionName: args['<name>'], role: roleArn })
      spinner.succeed(`Created new Lambda function with ARN: ${lambdaArn}`)

      const definition = args['--swagger']
        ? await swagger.loadSwaggerFile(args['--swagger'], lambdaArn)
        : await swagger.forwardAllDefinition(lambdaArn)

      spinner.start('Creating new API Gateway')
      const { id } = await amazon.createApiGateway({ definition, lambdaArn })
      spinner.succeed(`Created new API Gateway with id: ${id}`)

      if (args['--deploy-to']) {
        const stage = args['--deploy-to']
        const { region } = parseArn(lambdaArn)

        spinner.start('Deploying the API to a live address')
        await amazon.deployApiGateway({ id, stage })
        spinner.succeed(`Now serving live requests at: https://${id}.execute-api.${region}.amazonaws.com/${stage}`)
      }
    }

    if (args.update) {
      spinner.start('Packaging app for Lambda')
      const zipFile = await builder.createZipFile(process.cwd())
      spinner.succeed(`App packaged successfully! Final size: ${prettyBytes(zipFile.byteLength)}`)

      spinner.start('Creating Lambda function')
      const lambdaArn = await amazon.updateFunction({ zipFile, functionName: args['<name>'] })
      spinner.succeed(`Updated existing Lambda function with ARN: ${lambdaArn}`)

      const definition = args['--swagger']
        ? await swagger.loadSwaggerFile(args['--swagger'], lambdaArn)
        : await swagger.forwardAllDefinition(lambdaArn)

      const id = args['--rest-api-id']

      spinner.start('Updating existing API Gateway')
      await amazon.updateApiGateway({ id, definition, lambdaArn })
      spinner.succeed(`Updated existing API Gateway with id: ${id}`)

      if (args['--deploy-to']) {
        const stage = args['--deploy-to']
        const { region } = parseArn(lambdaArn)

        spinner.start('Deploying the API to a live address')
        await amazon.deployApiGateway({ id, stage })
        spinner.succeed(`Now serving live requests at: https://${id}.execute-api.${region}.amazonaws.com/${stage}`)
      }
    }
  } catch (err) {
    spinner.fail(err.toString())

    throw err
  }
}

main().catch((err) => {
  process.exitCode = 1
  console.error((err instanceof UserError) ? err.message : err.stack)
})

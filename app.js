#!/usr/bin/env node

/* Make sure that AWS uses local config files, since this is a CLI util */
process.env.AWS_SDK_LOAD_CONFIG = 'true'

const awsHasRegion = require('aws-has-region')
const isCI = require('is-ci')
const Listr = require('listr')
const listrVerboseRenderer = require('listr-verbose-renderer')
const neodoc = require('neodoc')

const tasks = require('./lib/tasks')

class UserError extends Error {}

const usage = `
Scandium

usage:
  scandium [global options] create <name> [--swagger=<swagger>] [--deploy-to=<stage>] [--role=<role>]
  scandium [global options] update <name> [--swagger=<swagger>] [--deploy-to=<stage>] --rest-api-id=<rest-api-id>

options:
  <name>          Name of the Lambda function.
  --role          ARN of the IAM role that Lambda assumes when it executes your function.
  --swagger       Path to Swagger API definition used to configure AWS API Gateway.
  --rest-api-id   ID of the AWS API Gateway rest api to update (printed by the "create" command).
  --deploy-to     Deploy the API to the specified stage, and make it callable from the Internet.

global options:
  --help          Show this help, then exit.
  --verbose       Print verbose output.
`

async function main () {
  const args = neodoc.run(usage, { laxPlacement: true })

  const listrOpts = {}

  if (isCI || args['--verbose']) {
    listrOpts.renderer = listrVerboseRenderer
  }

  const createList = new Listr([
    tasks.packageApp,
    tasks.createLambdaRole,
    tasks.createLambdaFunction,
    tasks.loadSwaggerDefinition,
    tasks.generateSwaggerDefinition,
    tasks.createApiGateway,
    tasks.deployApi
  ], listrOpts)

  const updateList = new Listr([
    tasks.packageApp,
    tasks.updateLambdaFunction,
    tasks.loadSwaggerDefinition,
    tasks.generateSwaggerDefinition,
    tasks.updateApiGateway,
    tasks.deployApi
  ], listrOpts)

  if (!awsHasRegion()) {
    throw new UserError(awsHasRegion.errorText)
  }

  if (args.create) {
    await createList.run({ args })
  }

  if (args.update) {
    await updateList.run({ args })
  }
}

main().catch((err) => {
  process.exitCode = 1
  console.error((err instanceof UserError) ? err.message : err.stack)
})

#!/usr/bin/env node

/* Make sure that AWS uses local config files, since this is a CLI util */
process.env.AWS_SDK_LOAD_CONFIG = 'true'

const neodoc = require('neodoc')
const awsHasRegion = require('aws-has-region')
const Listr = require('listr')
const isCI = require('is-ci')

const tasks = require('./lib/tasks')

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
  --verbose       Use verbose output renderer.
`

const args = neodoc.run(usage)

const listrOpts = {
  renderer: isCI || args['--verbose'] ? require('listr-verbose-renderer') : require('listr-update-renderer') 
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

async function main () {
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

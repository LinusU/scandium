#!/usr/bin/env node

/* Make sure that AWS uses local config files, since this is a CLI util */
process.env.AWS_SDK_LOAD_CONFIG = 'true'

const awsHasRegion = require('aws-has-region')
const isCI = require('is-ci')
const Listr = require('listr')
const listrVerboseRenderer = require('listr-verbose-renderer')
const neodoc = require('neodoc')

const tasks = require('./lib/tasks')
const UserError = require('./lib/user-error')

const usage = `
Scandium

usage:
  scandium create [options] <name>
  scandium update [options] <name>

options:
  <name>                       Name of the Lambda function.
  --deploy-to=<stage>          Deploy the API to the specified stage, and make it callable from the Internet.
  --help                       Show this help, then exit.
  --rest-api-id=<rest-api-id>  ID of the AWS API Gateway rest api to point to the Lambda function.
  --role=<role>                ARN of the IAM role that Lambda assumes when it executes your function.
  --swagger=<swagger>          Path to Swagger API definition used to configure AWS API Gateway.
  --verbose                    Print verbose output.
  --version                    Print the current version of Scandium, then exit.
  --env=<KEY>               Include an env var (e.g.: \`-env KEY=value\`). Can appear many times.
`

async function main () {
  const args = neodoc.run(usage, { repeatableOptions: true })

  const listrOpts = (isCI || args['--verbose']) ? { renderer: listrVerboseRenderer } : {}

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
  console.error((err instanceof UserError) ? `\n\u001b[1m\u001b[31m${err.message}\u001b[39m\u001b[22m` : err.stack)
})

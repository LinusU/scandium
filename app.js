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
  scandium create [options]
  scandium update [options]
  scandium build [options]
  scandium environment show [options]

options:
  --api-gateway-stage=<stage>  Deploy the API to the specified API Gateway stage, defaults to "default".
  --env=<key=value>...         Set environmental variables. Example: "--env PGHOST=linus.aivencloud.com".
  --env-from-file=<path>       Read and set environmental variables from the specified file.
  --help                       Show this help, then exit.
  --name=<name>                Name of the Lambda function. Default to the name property in your package.json.
  --name-postfix=<postfix>     Add postfix to name. Example: "--name-postfix -test" will add -test to the end of the name.
  --rest-api-id=<rest-api-id>  ID of the AWS API Gateway rest api to point to the Lambda function.
  --role=<role>                ARN of the IAM role that Lambda assumes when it executes your function.
  --swagger=<swagger>          Path to Swagger API definition used to configure AWS API Gateway.
  --verbose                    Print verbose output.
  --version                    Print the current version of Scandium, then exit.
  --output=<path>              Output built zip. Example: "--output scandium.zip"
`

async function main () {
  const args = neodoc.run(usage, { laxPlacement: true })
  const isVerbose = isCI || args['--verbose']
  const listrOpts = isVerbose ? { renderer: listrVerboseRenderer } : {}

  const createList = new Listr([
    tasks.parseOptions,
    tasks.packageApp,
    tasks.saveApp,
    tasks.createLambdaRole,
    tasks.createLambdaFunction,
    tasks.loadSwaggerDefinition,
    tasks.generateSwaggerDefinition,
    tasks.createApiGateway,
    tasks.deployApi
  ], listrOpts)

  const updateList = new Listr([
    tasks.parseOptions,
    tasks.packageApp,
    tasks.saveApp,
    tasks.getCurrentEnvironment,
    tasks.updateLambdaEnvironment,
    tasks.updateLambdaFunction,
    tasks.loadSwaggerDefinition,
    tasks.generateSwaggerDefinition,
    tasks.updateApiGateway,
    tasks.deployApi
  ], listrOpts)

  const buildList = new Listr([
    tasks.parseOptions,
    tasks.packageApp,
    tasks.saveApp
  ], listrOpts)

  const environmentList = new Listr([
    tasks.parseOptions,
    tasks.getCurrentEnvironment
  ], listrOpts)

  if (!awsHasRegion()) {
    throw new UserError(awsHasRegion.errorText)
  }

  if (args.create) {
    await createList.run({ args, isVerbose })
  }

  if (args.update) {
    await updateList.run({ args, isVerbose })
  }

  if (args.build) {
    args['--output'] = args['--output'] || 'scandium-app.zip'
    await buildList.run({ args, isVerbose })
  }

  if (args.environment && args.show) {
    const { currentEnvironment } = await environmentList.run({ args, isVerbose })

    for (const key of Object.keys(currentEnvironment)) {
      console.log(`${key}=${currentEnvironment[key]}`)
    }
  }
}

main().catch((err) => {
  process.exitCode = 1
  console.error((err instanceof UserError) ? `\n\u001b[1m\u001b[31m${err.message}\u001b[39m\u001b[22m` : err.stack)
})

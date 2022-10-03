#!/usr/bin/env node

import isCI from 'is-ci'
import Listr from 'listr'
import listrVerboseRenderer from 'listr-verbose-renderer'
import neodoc from 'neodoc'

import * as tasks from './lib/tasks.js'
import UserError from './lib/user-error.js'

const usage = `
Scandium

usage:
  scandium create [options]
  scandium update [options]
  scandium build [options]
  scandium environment show [options]

options:
  --api-gateway-stage=<stage>  Deploy the API to the specified API Gateway stage, defaults to "$default".
  --bucket=<name>              Use S3 bucket for deployment, needed for deployments over 50MB.
  --dry-run                    Build and package the app, but skip uploading and deploying.
  --entrypoint=<handler>       Use custom entrypoint handler instead of the Scandium built-in HTTP handler.
  --env=<key=value>...         Set environmental variables. Example: "--env PGHOST=linus.aivencloud.com".
  --env-from-file=<path>       Read and set environmental variables from the specified file.
  --help                       Show this help, then exit.
  --hooks=<hooks>              Path to a file with hooks to run on the Lambda in conjunction with the deploy.
  --http-api-id=<http-api-id>  ID of the AWS API Gateway http api to point to the Lambda function.
  --name-postfix=<postfix>     Add postfix to name. Example: "--name-postfix -test" will add -test to the end of the name.
  --name=<name>                Name of the Lambda function. Default to the name property in your package.json.
  --no-api-gateway             Skip updating/creating the API Gateway service.
  --output=<path>              Output built zip. Example: "--output scandium.zip"
  --rest-api-id=<rest-api-id>  ID of the AWS API Gateway rest api to point to the Lambda function.
  --role=<role>                ARN of the IAM role that Lambda assumes when it executes your function.
  --skip-node-modules          Skip including node_modules in the Lambda function. This is useful if you are already bundling your dependencies.
  --ssh-key=<path>             Use the specified SSH key when installing dependencies.
  --swagger=<swagger>          Path to Swagger API definition used to configure AWS API Gateway.
  --verbose                    Print verbose output.
  --version                    Print the current version of Scandium, then exit.
  --vpc-config=<vpc-config>    For network connectivity to Amazon Web Services resources in a VPC, specify a list of security groups and subnets in the VPC. When you connect a function to a VPC, it can only access resources and the internet through that VPC. Example: "SubnetIds=subnet-aabbccdd,subnet-eeffgghh,SecurityGroupIds=sg-iijjkkll" to set, or "SubnetIds=[],SecurityGroupIds=[]" to remove vpc access.
`

async function main () {
  const args = neodoc.run(usage, { laxPlacement: true })
  const isVerbose = isCI || args['--verbose']
  const listrOpts = isVerbose ? { renderer: listrVerboseRenderer } : {}

  const createList = new Listr([
    tasks.parseOptions,
    tasks.packageApp,
    tasks.saveApp,
    tasks.verifyCodeSize,
    tasks.uploadToS3,
    tasks.createLambdaRole,
    tasks.createLambdaFunction,
    tasks.invokeHooks,
    tasks.loadSwaggerDefinition,
    tasks.generateSwaggerDefinition,
    tasks.createApiGateway,
    tasks.deployApi
  ], listrOpts)

  const updateList = new Listr([
    tasks.parseOptions,
    tasks.packageApp,
    tasks.saveApp,
    tasks.verifyCodeSize,
    tasks.uploadToS3,
    tasks.getCurrentEnvironment,
    tasks.updateLambdaEnvironment,
    tasks.updateLambdaFunction,
    tasks.invokeHooks,
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

  const awsHasRegion = await import('aws-has-region')

  if (!(await awsHasRegion.default())) {
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

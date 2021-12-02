import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import amendObject from 'amend-object'
import dotenv from 'dotenv'
import loadJsonFile from 'load-json-file'
import parseArn from 'aws-arn-parser'
import parseKeyValuePair from 'parse-key-value-pair'
import bytes from 'bytes'
import formatDuration from 'format-duration'

import * as amazon from './amazon.js'
import * as builder from './builder.js'
import * as swagger from './swagger.js'
import UserError from './user-error.js'

const readFile = util.promisify(fs.readFile)
const writeFile = util.promisify(fs.writeFile)

const DEFAULT_ENVIRONMENT = {
  NODE_ENV: 'production'
}

export const parseOptions = {
  title: 'Parse options',
  task: async (ctx, task) => {
    if (ctx.args['--name']) {
      ctx.name = ctx.args['--name']
    } else {
      try {
        ctx.name = (await loadJsonFile('package.json')).name
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }

      if (!ctx.name) {
        throw new UserError('Please specify a name using the --name flag')
      }
    }

    ctx.dryRun = ctx.args['--dry-run'] || false
    ctx.skipNodeModules = ctx.args['--skip-node-modules'] || false

    if (ctx.args['--name-postfix']) {
      ctx.name = `${ctx.name}${ctx.args['--name-postfix']}`
    }

    ctx.environment = {}

    if (ctx.args['--env-from-file']) {
      Object.assign(ctx.environment, dotenv.parse(await readFile(ctx.args['--env-from-file'], 'utf-8')))
    }

    if (ctx.args['--env']) {
      amendObject(ctx.environment, ctx.args['--env'].map(parseKeyValuePair))
    }

    if (ctx.args['--output']) {
      ctx.outputPath = path.resolve(ctx.args['--output'])
    }

    if (ctx.args['--bucket']) {
      ctx.bucket = ctx.args['--bucket']
    }

    if (ctx.args['--ssh-key']) {
      ctx.sshKey = ctx.args['--ssh-key']
    }

    if (ctx.args['--entrypoint']) {
      ctx.customEntrypoint = true
      ctx.entrypointHandler = ctx.args['--entrypoint']
    } else {
      ctx.customEntrypoint = false
      ctx.entrypointHandler = 'scandium-entrypoint.handler'
    }
  }
}

export const packageApp = {
  title: 'Packaging app for Lambda',
  task: async (ctx, task) => {
    const startedAt = Date.now()

    let ticker
    if (!ctx.isVerbose) {
      ticker = setInterval(() => { task.title = `Packaging app for Lambda (${formatDuration(Date.now() - startedAt)})` }, 100)
    }

    try {
      ctx.code = { ZipFile: await builder.createZipFile(process.cwd(), { customEntrypoint: ctx.customEntrypoint, skipNodeModules: ctx.skipNodeModules, sshKey: ctx.sshKey }) }
    } finally {
      if (ticker) clearInterval(ticker)
    }

    task.title = `App packaged successfully in ${formatDuration(Date.now() - startedAt)}! Final size: ${bytes.format(ctx.code.ZipFile.byteLength)}`
  }
}

export const saveApp = {
  title: 'Saving packaged app',
  enabled: (ctx) => Boolean(ctx.outputPath) && !ctx.dryRun,
  task: async (ctx, task) => {
    if (!ctx.code) throw new Error('Missing ctx.code')
    if (!ctx.code.ZipFile) throw new Error('Missing ctx.code.ZipFile')

    await writeFile(ctx.outputPath, ctx.code.ZipFile)
    task.title = `Packaged app saved to ${ctx.outputPath}`
  }
}

export const verifyCodeSize = {
  title: 'Verify code size',
  task: async (ctx, task) => {
    if (!ctx.code) throw new Error('Missing ctx.code')
    if (!ctx.code.ZipFile) throw new Error('Missing ctx.code.ZipFile')

    amazon.verifyCodeSize(ctx.code.ZipFile, { usingS3: Boolean(ctx.bucket) })
  }
}

export const uploadToS3 = {
  title: 'Uploading zip to S3',
  enabled: (ctx) => Boolean(ctx.bucket) && !ctx.dryRun,
  task: async (ctx, task) => {
    if (!ctx.code) throw new Error('Missing ctx.code')
    if (!ctx.code.ZipFile) throw new Error('Missing ctx.code.ZipFile')

    const key = await amazon.uploadToS3({ zipFile: ctx.code.ZipFile, functionName: ctx.name, bucketName: ctx.bucket })
    ctx.code = { S3Key: key, S3Bucket: ctx.bucket }
  }
}

export const createLambdaRole = {
  title: 'Creating Lambda role',
  enabled: (ctx) => !ctx.dryRun,
  task: async (ctx, task) => {
    if (ctx.args['--role']) {
      ctx.roleArn = ctx.args['--role']
      task.skip('Using provided role')
    } else {
      ctx.roleArn = await amazon.createLambdaRole(ctx.name)
      task.title = `Created new Lambda role with ARN: ${ctx.roleArn}`
    }
  }
}

export const createLambdaFunction = {
  title: 'Creating Lambda function',
  enabled: (ctx) => !ctx.dryRun,
  task: async (ctx, task) => {
    ctx.environment = Object.assign({}, DEFAULT_ENVIRONMENT, ctx.environment)
    const onFailedAttempt = (error) => {
      task.title = `Attempt ${error.attemptNumber} failed. There are ${error.attemptsLeft} attempts left.`
    }
    ctx.lambdaArn = await amazon.createFunction({ code: ctx.code, functionName: ctx.name, handler: ctx.entrypointHandler, role: ctx.roleArn, environment: ctx.environment, onFailedAttempt })
    task.title = `Created new Lambda function with ARN: ${ctx.lambdaArn}`
  }
}

export const updateLambdaFunction = {
  title: 'Updating Lambda function',
  enabled: (ctx) => !ctx.dryRun,
  task: async (ctx, task) => {
    try {
      ctx.lambdaArn = await amazon.updateFunction({ code: ctx.code, functionName: ctx.name, handler: ctx.entrypointHandler })
      task.title = `Updated existing Lambda function with ARN: ${ctx.lambdaArn}`
    } catch (err) {
      if (err.code === 'ResourceNotFoundException') {
        throw new UserError(`Unable to find a Lambda function named "${ctx.name}", did you mean to run the create command?`)
      }

      throw err
    }
  }
}

export const updateLambdaEnvironment = {
  title: 'Update Lambda environment',
  enabled: (ctx) => Boolean(ctx.args['--env-from-file'] || ctx.args['--env']) && !ctx.dryRun,
  task: async (ctx, task) => {
    if (!ctx.currentEnvironment) throw new Error('Missing ctx.currentEnvironment')
    ctx.environment = Object.assign({}, ctx.currentEnvironment, ctx.environment)

    await amazon.updateFunctionEnvironment({ functionName: ctx.name, environment: ctx.environment })
    task.title = 'Updated existing Lambda environment'
  }
}

export const invokeHooks = {
  title: 'Invoke hooks',
  enabled: (ctx) => Boolean(ctx.args['--hooks']) && !ctx.dryRun,
  task: async (ctx, task) => {
    const onFailedAttempt = (error) => {
      task.title = `Attempt ${error.attemptNumber} failed. There are ${error.attemptsLeft} attempts left.`
    }
    const payload = { scandiumInvokeHook: { file: ctx.args['--hooks'], hook: 'deploy' } }
    const { log } = await amazon.invokeLambda({ functionName: ctx.lambdaArn, onFailedAttempt, payload })
    task.title = `Invoked hooks:\n\n${log}`
  }
}

export const loadSwaggerDefinition = {
  title: 'Load Swagger definition',
  enabled: (ctx) => !ctx.args['--no-api-gateway'] && Boolean(ctx.args['--swagger']) && !ctx.dryRun,
  task: async (ctx, task) => {
    if (ctx.apiGatewayType === 'REST') {
      ctx.definition = await swagger.loadSwaggerFileV1(ctx.args['--swagger'], ctx.name, ctx.lambdaArn)
    } else {
      ctx.definition = await swagger.loadSwaggerFileV2(ctx.args['--swagger'], ctx.name, ctx.lambdaArn)
    }

    task.title = 'Loaded Swagger definition from file'
  }
}

export const generateSwaggerDefinition = {
  title: 'Generate Swagger definition',
  enabled: (ctx) => !ctx.args['--no-api-gateway'] && !ctx.args['--swagger'] && !ctx.dryRun,
  task: async (ctx, task) => {
    if (ctx.apiGatewayType === 'REST') {
      ctx.definition = await swagger.forwardAllDefinitionV1(ctx.name, ctx.lambdaArn)
    } else {
      ctx.definition = await swagger.forwardAllDefinitionV2(ctx.name, ctx.lambdaArn)
    }

    task.title = 'Generated "forward all" Swagger definition'
  }
}

export const createApiGateway = {
  title: 'Creating new API Gateway',
  enabled: (ctx) => !ctx.args['--no-api-gateway'] && !ctx.dryRun,
  task: async (ctx, task) => {
    if (ctx.args['--rest-api-id']) {
      ctx.id = ctx.args['--rest-api-id']
      task.skip('Using provided API Gateway')
    } else {
      ctx.id = await amazon.createApiGateway({ definition: ctx.definition, lambdaArn: ctx.lambdaArn })
      task.title = `Created new API Gateway with id: ${ctx.id}`
    }
  }
}

export const updateApiGateway = {
  title: 'Updating existing API Gateway',
  enabled: (ctx) => !ctx.args['--no-api-gateway'] && !ctx.dryRun,
  task: async (ctx, task) => {
    if (ctx.args['--http-api-id']) {
      ctx.id = ctx.args['--http-api-id']
      ctx.apiGatewayType = 'HTTP'
    } else if (ctx.args['--rest-api-id']) {
      ctx.id = ctx.args['--rest-api-id']
      ctx.apiGatewayType = 'REST'
    } else {
      ctx.id = await amazon.findApiGateway(ctx.name)
      ctx.apiGatewayType = 'HTTP'
    }

    task.title = `Updating existing ${ctx.apiGatewayType} API Gateway with id: ${ctx.id}`

    if (ctx.apiGatewayType === 'REST') {
      await amazon.updateApiGatewayV1({ id: ctx.id, definition: ctx.definition, lambdaArn: ctx.lambdaArn })
    } else {
      await amazon.updateApiGatewayV2({ id: ctx.id, definition: ctx.definition, lambdaArn: ctx.lambdaArn })
    }

    task.title = `Updated existing ${ctx.apiGatewayType} API Gateway with id: ${ctx.id}`
  }
}

export const deployApi = {
  title: 'Deploying the API to a live address',
  enabled: (ctx) => !ctx.args['--no-api-gateway'] && !ctx.dryRun,
  task: async (ctx, task) => {
    const { region } = parseArn(ctx.lambdaArn)

    if (ctx.apiGatewayType === 'REST') {
      const stage = ctx.args['--api-gateway-stage'] || 'default'
      task.title = `Deploying the API to API Gateway stage: ${stage}, region: ${region}`
      await amazon.deployApiGatewayV1({ id: ctx.id, stage })
      task.title = `Now serving live requests at: https://${ctx.id}.execute-api.${region}.amazonaws.com/${stage}`
    } else {
      const stage = ctx.args['--api-gateway-stage'] || '$default'
      task.title = `Deploying the API to API Gateway stage: ${stage}, region: ${region}`
      await amazon.deployApiGatewayV2({ id: ctx.id, stage })
      task.title = `Now serving live requests at: https://${ctx.id}.execute-api.${region}.amazonaws.com${stage === '$default' ? '' : `/${stage}`}`
    }
  }
}

export const getCurrentEnvironment = {
  title: 'Fetching current environment',
  enabled: (ctx) => Boolean(ctx.args['--env-from-file'] || ctx.args['--env'] || ctx.args.environment),
  task: async (ctx, task) => {
    ctx.currentEnvironment = await amazon.getFunctionEnvironment({ functionName: ctx.name })
  }
}

const fs = require('fs')
const path = require('path')
const util = require('util')

const amendObject = require('amend-object')
const dotenv = require('dotenv')
const loadJsonFile = require('load-json-file')
const parseArn = require('aws-arn-parser')
const parseKeyValuePair = require('parse-key-value-pair')
const bytes = require('bytes')
const formatDuration = require('format-duration')

const amazon = require('./amazon')
const builder = require('./builder')
const swagger = require('./swagger')
const UserError = require('./user-error')

const readFile = util.promisify(fs.readFile)
const writeFile = util.promisify(fs.writeFile)

const DEFAULT_ENVIRONMENT = {
  NODE_ENV: 'production'
}

exports.parseOptions = {
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

    ctx.apiGatewayStage = ctx.args['--api-gateway-stage'] || 'default'

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
  }
}

exports.packageApp = {
  title: 'Packaging app for Lambda',
  task: async (ctx, task) => {
    const startedAt = Date.now()
    const ticker = setInterval(() => { task.title = `Packaging app for Lambda (${formatDuration(Date.now() - startedAt)})` }, 100)

    try {
      ctx.code = { ZipFile: await builder.createZipFile(process.cwd()) }
    } finally {
      clearInterval(ticker)
    }

    task.title = `App packaged successfully in ${formatDuration(Date.now() - startedAt)}! Final size: ${bytes.format(ctx.code.ZipFile.byteLength)}`
  }
}

exports.saveApp = {
  title: 'Saving packaged app',
  enabled: (ctx) => Boolean(ctx.outputPath),
  task: async (ctx, task) => {
    if (!ctx.code) throw new Error('Missing ctx.code')
    if (!ctx.code.ZipFile) throw new Error('Missing ctx.code.ZipFile')

    await writeFile(ctx.outputPath, ctx.code.ZipFile)
    task.title = `Packaged app saved to ${ctx.outputPath}`
  }
}

exports.verifyCodeSize = {
  title: 'Verify code size',
  task: async (ctx, task) => {
    if (!ctx.code) throw new Error('Missing ctx.code')
    if (!ctx.code.ZipFile) throw new Error('Missing ctx.code.ZipFile')

    amazon.verifyCodeSize(ctx.code.ZipFile, { usingS3: Boolean(ctx.bucket) })
  }
}

exports.uploadToS3 = {
  title: 'Uploading zip to S3',
  enabled: (ctx) => Boolean(ctx.bucket),
  task: async (ctx, task) => {
    if (!ctx.code) throw new Error('Missing ctx.code')
    if (!ctx.code.ZipFile) throw new Error('Missing ctx.code.ZipFile')

    const key = await amazon.uploadToS3({ zipFile: ctx.code.ZipFile, functionName: ctx.name, bucketName: ctx.bucket })
    ctx.code = { S3Key: key, S3Bucket: ctx.bucket }
  }
}

exports.createLambdaRole = {
  title: 'Creating Lambda role',
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

exports.createLambdaFunction = {
  title: 'Creating Lambda function',
  task: async (ctx, task) => {
    ctx.environment = Object.assign({}, DEFAULT_ENVIRONMENT, ctx.environment)
    const onFailedAttempt = (error) => {
      task.title = `Attempt ${error.attemptNumber} failed. There are ${error.attemptsLeft} attempts left.`
    }
    ctx.lambdaArn = await amazon.createFunction({ code: ctx.code, functionName: ctx.name, role: ctx.roleArn, environment: ctx.environment, onFailedAttempt })
    task.title = `Created new Lambda function with ARN: ${ctx.lambdaArn}`
  }
}

exports.updateLambdaFunction = {
  title: 'Updating Lambda function',
  task: async (ctx, task) => {
    try {
      ctx.lambdaArn = await amazon.updateFunction({ code: ctx.code, functionName: ctx.name })
      task.title = `Updated existing Lambda function with ARN: ${ctx.lambdaArn}`
    } catch (err) {
      if (err.code === 'ResourceNotFoundException') {
        throw new UserError(`Unable to find a Lambda function named "${ctx.name}", did you mean to run the create command?`)
      }

      throw err
    }
  }
}

exports.updateLambdaEnvironment = {
  title: 'Update Lambda environment',
  enabled: (ctx) => Boolean(ctx.args['--env-from-file'] || ctx.args['--env']),
  task: async (ctx, task) => {
    if (!ctx.currentEnvironment) throw new Error('Missing ctx.currentEnvironment')
    ctx.environment = Object.assign({}, ctx.currentEnvironment, ctx.environment)

    await amazon.updateFunctionEnvironment({ functionName: ctx.name, environment: ctx.environment })
    task.title = `Updated existing Lambda environment`
  }
}

exports.loadSwaggerDefinition = {
  title: 'Load Swagger definition',
  enabled: (ctx) => Boolean(ctx.args['--swagger']),
  task: async (ctx, task) => {
    ctx.definition = await swagger.loadSwaggerFile(ctx.args['--swagger'], ctx.name, ctx.lambdaArn)
    task.title = 'Loaded Swagger definition from file'
  }
}

exports.generateSwaggerDefinition = {
  title: 'Generate Swagger definition',
  enabled: (ctx) => !ctx.args['--swagger'],
  task: async (ctx, task) => {
    ctx.definition = await swagger.forwardAllDefinition(ctx.name, ctx.lambdaArn)
    task.title = 'Generated "forward all" Swagger definition'
  }
}

exports.createApiGateway = {
  title: 'Creating new API Gateway',
  task: async (ctx, task) => {
    if (ctx.args['--rest-api-id']) {
      ctx.id = ctx.args['--rest-api-id']
      task.skip('Using provided API Gateway')
    } else {
      ctx.id = (await amazon.createApiGateway({ definition: ctx.definition, lambdaArn: ctx.lambdaArn })).id
      task.title = `Created new API Gateway with id: ${ctx.id}`
    }
  }
}

exports.updateApiGateway = {
  title: 'Updating existing API Gateway',
  task: async (ctx, task) => {
    if (ctx.args['--rest-api-id']) {
      ctx.id = ctx.args['--rest-api-id']
    } else {
      ctx.id = await amazon.findApiGateway(ctx.name)
    }

    await amazon.updateApiGateway({ id: ctx.id, definition: ctx.definition, lambdaArn: ctx.lambdaArn })
    task.title = `Updated existing API Gateway with id: ${ctx.id}`
  }
}

exports.deployApi = {
  title: 'Deploying the API to a live address',
  enabled: (ctx) => Boolean(ctx.apiGatewayStage),
  task: async (ctx, task) => {
    const stage = ctx.apiGatewayStage
    const { region } = parseArn(ctx.lambdaArn)

    task.title = `Deploying the API to API Gateway stage: ${stage}, region: ${region}`

    await amazon.deployApiGateway({ id: ctx.id, stage })
    task.title = `Now serving live requests at: https://${ctx.id}.execute-api.${region}.amazonaws.com/${stage}`
  }
}

exports.getCurrentEnvironment = {
  title: 'Fetching current environment',
  enabled: (ctx) => Boolean(ctx.args['--env-from-file'] || ctx.args['--env'] || ctx.args['environment']),
  task: async (ctx, task) => {
    ctx.currentEnvironment = await amazon.getFunctionEnvironment({ functionName: ctx.name })
  }
}

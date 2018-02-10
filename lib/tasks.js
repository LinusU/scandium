const parseArn = require('aws-arn-parser')
const prettyBytes = require('pretty-bytes')

const amazon = require('./amazon')
const builder = require('./builder')
const swagger = require('./swagger')
const parseEnv = require('./parse-env')
const UserError = require('./user-error')

exports.packageApp = {
  title: 'Packaging app for Lambda',
  task: async (ctx, task) => {
    ctx.zipFile = await builder.createZipFile(process.cwd())
    task.title = `App packaged successfully! Final size: ${prettyBytes(ctx.zipFile.byteLength)}`
  }
}

exports.createLambdaRole = {
  title: 'Creating Lambda role',
  task: async (ctx, task) => {
    if (ctx.args['--role']) {
      ctx.roleArn = ctx.args['--role']
      task.skip('Using provided role')
    } else {
      ctx.roleArn = await amazon.createLambdaRole(ctx.args['<name>'])
      task.title = `Created new Lambda role with ARN: ${ctx.roleArn}`
    }
  }
}

exports.createLambdaFunction = {
  title: 'Creating Lambda function',
  task: async (ctx, task) => {
    const env = parseEnv(args['--env'])

    ctx.lambdaArn = await amazon.createFunction({ zipFile: ctx.zipFile, functionName: ctx.args['<name>'], role: ctx.roleArn, env })
    task.title = `Created new Lambda function with ARN: ${ctx.lambdaArn}`
  }
}

exports.updateLambdaFunction = {
  title: 'Updating Lambda function',
  task: async (ctx, task) => {
    const env = parseEnv(args['--env'])

    try {
      ctx.lambdaArn = await amazon.updateFunction({ zipFile: ctx.zipFile, functionName: ctx.args['<name>'], env })
      task.title = `Updated existing Lambda function with ARN: ${ctx.lambdaArn}`
    } catch (err) {
      if (err.code === 'ResourceNotFoundException') {
        throw new UserError(`Unable to find a Lambda function named "${ctx.args['<name>']}", did you mean to run the create command?`)
      }

      throw err
    }
  }
}

exports.loadSwaggerDefinition = {
  title: 'Load Swagger definition',
  enabled: (ctx) => Boolean(ctx.args['--swagger']),
  task: async (ctx, task) => {
    ctx.definition = await swagger.loadSwaggerFile(ctx.args['--swagger'], ctx.args['<name>'], ctx.lambdaArn)
    task.title = 'Loaded Swagger definition from file'
  }
}

exports.generateSwaggerDefinition = {
  title: 'Generate Swagger definition',
  enabled: (ctx) => !ctx.args['--swagger'],
  task: async (ctx, task) => {
    ctx.definition = await swagger.forwardAllDefinition(ctx.args['<name>'], ctx.lambdaArn)
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
      ctx.id = await amazon.findApiGateway(ctx.args['<name>'])
    }

    await amazon.updateApiGateway({ id: ctx.id, definition: ctx.definition, lambdaArn: ctx.lambdaArn })
    task.title = `Updated existing API Gateway with id: ${ctx.id}`
  }
}

exports.deployApi = {
  title: 'Deploying the API to a live address',
  enabled: (ctx) => Boolean(ctx.args['--deploy-to']),
  task: async (ctx, task) => {
    const stage = ctx.args['--deploy-to']
    const { region } = parseArn(ctx.lambdaArn)

    await amazon.deployApiGateway({ id: ctx.id, stage })
    task.title = `Now serving live requests at: https://${ctx.id}.execute-api.${region}.amazonaws.com/${stage}`
  }
}

const parseArn = require('aws-arn-parser')
const prettyBytes = require('pretty-bytes')

const amazon = require('./amazon')
const builder = require('./builder')
const swagger = require('./swagger')

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
    ctx.lambdaArn = await amazon.createFunction({ zipFile: ctx.zipFile, functionName: ctx.args['<name>'], role: ctx.roleArn })
    task.title = `Created new Lambda function with ARN: ${ctx.lambdaArn}`
  }
}

exports.updateLambdaFunction = {
  title: 'Updating Lambda function',
  task: async (ctx, task) => {
    ctx.lambdaArn = await amazon.updateFunction({ zipFile: ctx.zipFile, functionName: ctx.args['<name>'] })
    task.title = `Updated existing Lambda function with ARN: ${ctx.lambdaArn}`
  }
}

exports.loadSwaggerDefinition = {
  title: 'Load Swagger definition',
  enabled: (ctx) => Boolean(ctx.args['--swagger']),
  task: async (ctx, task) => {
    ctx.definition = await swagger.loadSwaggerFile(ctx.args['--swagger'], ctx.lambdaArn)
    task.title = 'Loaded Swagger definition from file'
  }
}

exports.generateSwaggerDefinition = {
  title: 'Generate Swagger definition',
  enabled: (ctx) => !ctx.args['--swagger'],
  task: async (ctx, task) => {
    ctx.definition = await swagger.forwardAllDefinition(ctx.lambdaArn)
    task.title = 'Generated "forward all" Swagger definition'
  }
}

exports.createApiGateway = {
  title: 'Creating new API Gateway',
  task: async (ctx, task) => {
    ctx.id = (await amazon.createApiGateway({ definition: ctx.definition, lambdaArn: ctx.lambdaArn })).id
    task.title = `Created new API Gateway with id: ${ctx.id}`
  }
}

exports.updateApiGateway = {
  title: 'Updating existing API Gateway',
  task: async (ctx, task) => {
    ctx.id = ctx.args['--rest-api-id']
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

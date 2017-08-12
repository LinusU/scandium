#!/usr/bin/env node

const path = require('path')

const aws = require('aws-sdk')
const cpFile = require('cp-file')
const execa = require('execa')
const neodoc = require('neodoc')
const rmFile = require('rm-file')

const lambda = new aws.Lambda({ apiVersion: '2015-03-31' })

const usage = `
Scandium

Usage:
  scandium create <name> --role=<role>
  scandium update <name>

Options:
  <name>    Name of the Lambda function.
  --role    ARN of the IAM role that Lambda assumes when it executes your function.
`

const defaultParams = {
  MemorySize: 320,
  Timeout: 3,
  Runtime: 'nodejs6.10'
}

async function createZipFile (directory) {
  await cpFile(path.join(__dirname, 'dockerfile.txt'), path.join(directory, 'scandium-dockerfile'))
  await cpFile(path.join(__dirname, 'entrypoint.js'), path.join(directory, 'scandium-entrypoint.js'))

  const imageId = await execa.stdout('docker', ['build', '--quiet', '--file', 'scandium-dockerfile', '.'], { cwd: directory })
  const zipFile = await execa.stdout('docker', ['run', '--rm', imageId], { cwd: directory })

  await rmFile(path.join(directory, 'scandium-dockerfile'))
  await rmFile(path.join(directory, 'scandium-entrypoint.js'))

  return Buffer.from(zipFile, 'base64')
}

function createFunction ({ zipFile, functionName, role }) {
  const params = {
    Code: { ZipFile: zipFile },
    FunctionName: functionName,
    Handler: 'scandium-entrypoint.handler',
    MemorySize: defaultParams.MemorySize,
    Publish: true,
    Role: role,
    Runtime: defaultParams.Runtime,
    Timeout: defaultParams.Timeout
  }

  return lambda.createFunction(params).promise()
}

function updateFunction ({ zipFile, functionName }) {
  const params = {
    FunctionName: functionName,
    Publish: true,
    ZipFile: zipFile
  }

  return lambda.updateFunctionCode(params).promise()
}

async function main () {
  const args = neodoc.run(usage)

  if (args.create) {
    const zipFile = await createZipFile(process.cwd())
    const result = await createFunction({ zipFile, functionName: args['<name>'], role: args['--role'] })

    console.log(`Created new Lambda function with ARN: ${result.FunctionArn}`)
  }

  if (args.update) {
    const zipFile = await createZipFile(process.cwd())
    const result = await updateFunction({ zipFile, functionName: args['<name>'] })

    console.log(`Updated existing Lambda function with ARN: ${result.FunctionArn}`)
  }
}

main().catch((err) => {
  process.exitCode = 1
  console.error(err.stack)
})

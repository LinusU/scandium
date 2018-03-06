const fs = require('fs')
const path = require('path')

const bytes = require('bytes')
const cpFile = require('cp-file')
const execa = require('execa')
const loadJsonFile = require('load-json-file')
const pathExists = require('path-exists')
const rmFile = require('rm-file')
const unload = require('unload')
const writeFile = require('write-file-atomically')

function writeJsonFile (path, data) {
  return new Promise((resolve, reject) => {
    fs.writeFile(path, JSON.stringify(data, null, 2), (err) => (err ? reject(err) : resolve()))
  })
}

const defaultIgnore = ['.git/', 'node_modules/'].join('\n') + '\n'

const SCANDIUM_FILES = ['scandium-clean-package-lock.json', 'scandium-clean-package.json', 'scandium-entrypoint.js', 'scandium-dockerfile']

exports.createZipFile = async function (directory) {
  const cleanup = () => SCANDIUM_FILES.map(file => path.join(directory, file)).forEach(rmFile.sync)
  const removeUnloadCleanupHandler = unload.add(cleanup)

  const packageInfo = await loadJsonFile(path.join(directory, 'package.json'))
  const packageLock = await loadJsonFile(path.join(directory, 'package-lock.json'))

  const cleanPackageInfo = Object.assign({}, packageInfo, { version: '0.0.0', scripts: undefined })
  const cleanPackageLock = Object.assign({}, packageLock, { version: '0.0.0' })

  const hasPrepare = (packageInfo.scripts && packageInfo.scripts.prepare)
  const dockerfile = (hasPrepare ? 'prepare.txt' : 'plain.txt')

  const hasIgnoreFile = await pathExists(path.join(directory, '.dockerignore'))

  await cpFile(path.join(__dirname, '../dockerfiles', dockerfile), path.join(directory, 'scandium-dockerfile'))
  await cpFile(path.join(__dirname, '../entrypoint.js'), path.join(directory, 'scandium-entrypoint.js'))

  await writeJsonFile(path.join(directory, 'scandium-clean-package.json'), cleanPackageInfo)
  await writeJsonFile(path.join(directory, 'scandium-clean-package-lock.json'), cleanPackageLock)

  if (!hasIgnoreFile) {
    await writeFile(path.join(directory, '.dockerignore'), defaultIgnore)
  }

  const imageId = await execa.stdout('docker', ['build', '--quiet', '--file', 'scandium-dockerfile', '.'], { cwd: directory })
  const zipFile = await execa.stdout('docker', ['run', '--rm', imageId], { cwd: directory, maxBuffer: bytes.parse('100mb') })

  if (!hasIgnoreFile) {
    await rmFile(path.join(directory, '.dockerignore'))
  }

  cleanup()
  removeUnloadCleanupHandler()

  return Buffer.from(zipFile, 'base64')
}

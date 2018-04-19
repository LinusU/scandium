const path = require('path')

const bytes = require('bytes')
const cpFile = require('cp-file')
const execa = require('execa')
const loadJsonFile = require('load-json-file')
const pathExists = require('path-exists')
const rmFile = require('rm-file')
const unload = require('unload')
const writeFile = require('write-file-atomically')

const dockerfile = require('./dockerfile')

function writeJsonFile (path, data) {
  return writeFile(path, JSON.stringify(data, null, 2) + '\n')
}

const DEFAULT_IGNORE = ['.git/', 'node_modules/'].join('\n') + '\n'

exports.createZipFile = async function (directory) {
  const cleanupFiles = []
  const cleanup = () => cleanupFiles.map(file => path.join(directory, file)).forEach(rmFile.sync)
  const removeUnloadCleanupHandler = unload.add(cleanup)

  const hasYarnLockfile = await pathExists(path.join(directory, 'yarn.lock'))

  const packageInfo = await loadJsonFile(path.join(directory, 'package.json'))
  const packageLock = hasYarnLockfile ? null : await loadJsonFile(path.join(directory, 'package-lock.json'))

  const cleanPackageInfo = Object.assign({}, packageInfo, { version: '0.0.0', scripts: undefined })
  const cleanPackageLock = hasYarnLockfile ? null : Object.assign({}, packageLock, { version: '0.0.0' })

  const hasPrepare = (packageInfo.scripts && packageInfo.scripts.prepare)
  const dockerfileSource = dockerfile.generate({ prepare: hasPrepare, yarn: hasYarnLockfile })

  const hasIgnoreFile = await pathExists(path.join(directory, '.dockerignore'))

  await writeFile(path.join(directory, 'scandium-dockerfile'), dockerfileSource)
  cleanupFiles.push('scandium-dockerfile')

  await cpFile(path.join(__dirname, '../entrypoint.js'), path.join(directory, 'scandium-entrypoint.js'))
  cleanupFiles.push('scandium-entrypoint.js')

  await writeJsonFile(path.join(directory, 'scandium-clean-package.json'), cleanPackageInfo)
  cleanupFiles.push('scandium-clean-package.json')

  if (!hasYarnLockfile) {
    await writeJsonFile(path.join(directory, 'scandium-clean-package-lock.json'), cleanPackageLock)
    cleanupFiles.push('scandium-clean-package-lock.json')
  }

  if (!hasIgnoreFile) {
    await writeFile(path.join(directory, '.dockerignore'), DEFAULT_IGNORE)
    cleanupFiles.push('.dockerignore')
  }

  const imageId = await execa.stdout('docker', ['build', '--quiet', '--file', 'scandium-dockerfile', '.'], { cwd: directory })

  cleanup()
  removeUnloadCleanupHandler()

  const zipFile = await execa.stdout('docker', ['run', '--rm', imageId], { maxBuffer: bytes.parse('100mb') })

  return Buffer.from(zipFile, 'base64')
}

const fs = require('fs')
const path = require('path')

const bytes = require('bytes')
const cpFile = require('cp-file')
const execa = require('execa')
const gitignoreToDockerignore = require('gitignore-to-dockerignore')
const loadJsonFile = require('load-json-file')
const loadTextFile = require('load-text-file')
const pathExists = require('path-exists')
const rmFile = require('rm-file')
const unload = require('unload')
const writeFile = require('write-file-atomically')

const dockerfile = require('./dockerfile')

function writeJsonFile (path, data) {
  return writeFile(path, JSON.stringify(data, null, 2) + '\n')
}

function loadGitignoreFile (path) {
  return loadTextFile(path).then(gitignoreToDockerignore)
}

const DEFAULT_IGNORE = ['.git/', 'node_modules/'].join('\n') + '\n'

exports.createZipFile = async function (directory, { customEntrypoint, skipNodeModules, sshKey }) {
  const cleanupFiles = []
  const cleanup = () => cleanupFiles.map(file => path.join(directory, file)).forEach(rmFile.sync)
  const removeUnloadCleanupHandler = unload.add(cleanup)

  const hasYarnLockfile = await pathExists(path.join(directory, 'yarn.lock'))

  const packageInfo = await loadJsonFile(path.join(directory, 'package.json'))
  const packageLock = hasYarnLockfile ? null : await loadJsonFile(path.join(directory, 'package-lock.json'))

  const cleanPackageInfo = Object.assign({}, packageInfo, { version: '0.0.0', scripts: undefined })
  const cleanPackageLock = hasYarnLockfile ? null : Object.assign({}, packageLock, { version: '0.0.0' })

  const hasBuildScript = Boolean(packageInfo.scripts && packageInfo.scripts.build)
  const hasPrepareScript = Boolean(packageInfo.scripts && packageInfo.scripts.prepare)
  const hasProductionDependencies = Boolean(packageInfo.dependencies && Object.keys(packageInfo.dependencies).length)
  const dockerfileSource = dockerfile.generate({ hasBuildScript, hasPrepareScript, hasProductionDependencies, skipNodeModules, sshKey: Boolean(sshKey), yarn: hasYarnLockfile })

  const hasDockerignore = await pathExists(path.join(directory, '.dockerignore'))
  const hasGitignore = await pathExists(path.join(directory, '.gitignore'))

  await writeFile(path.join(directory, 'scandium-dockerfile'), dockerfileSource)
  cleanupFiles.push('scandium-dockerfile')

  if (!customEntrypoint) {
    await cpFile(path.join(__dirname, '../entrypoint.js'), path.join(directory, 'scandium-entrypoint.js'))
    cleanupFiles.push('scandium-entrypoint.js')
  }

  await writeJsonFile(path.join(directory, 'scandium-clean-package.json'), cleanPackageInfo)
  cleanupFiles.push('scandium-clean-package.json')

  if (!hasYarnLockfile) {
    await writeJsonFile(path.join(directory, 'scandium-clean-package-lock.json'), cleanPackageLock)
    cleanupFiles.push('scandium-clean-package-lock.json')
  }

  if (!hasDockerignore) {
    const ignore = hasGitignore ? await loadGitignoreFile(path.join(directory, '.gitignore')) : DEFAULT_IGNORE
    await writeFile(path.join(directory, '.dockerignore'), '.dockerignore\n' + ignore)
    cleanupFiles.push('.dockerignore')
  }

  let imageId
  if (sshKey) {
    const sshKeyPrivate = fs.readFileSync(sshKey).toString('base64')
    const sshKeyPublic = fs.readFileSync(`${sshKey}.pub`).toString('base64')
    imageId = await execa.stdout('docker', ['build', '--platform', 'linux/amd64', '--quiet', '--build-arg', 'SSH_PRIVATE_KEY', '--build-arg', 'SSH_PUBLIC_KEY', '--file', 'scandium-dockerfile', '.'], { cwd: directory, env: { SSH_PRIVATE_KEY: sshKeyPrivate, SSH_PUBLIC_KEY: sshKeyPublic } })
  } else {
    imageId = await execa.stdout('docker', ['build', '--platform', 'linux/amd64', '--quiet', '--file', 'scandium-dockerfile', '.'], { cwd: directory })
  }

  cleanup()
  removeUnloadCleanupHandler()

  const zipFile = await execa.stdout('docker', ['run', '--platform', 'linux/amd64', '--rm', imageId], { maxBuffer: bytes.parse('134mb') })

  return Buffer.from(zipFile, 'base64')
}

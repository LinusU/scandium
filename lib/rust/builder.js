const fs = require('fs')
const path = require('path')

const bytes = require('bytes')
const execa = require('execa')
const gitignoreToDockerignore = require('gitignore-to-dockerignore')
const loadTextFile = require('load-text-file')
const pathExists = require('path-exists')
const rmFile = require('rm-file')
const unload = require('unload')
const writeFile = require('write-file-atomically')

const dockerfile = require('./dockerfile')

function loadGitignoreFile (path) {
  return loadTextFile(path).then(gitignoreToDockerignore)
}

const DEFAULT_IGNORE = ['target/', '*.rs.bk'].join('\n') + '\n'

exports.createZipFile = async function (directory, { customEntrypoint, sshKey }) {
  const cleanupFiles = []
  const cleanup = () => cleanupFiles.map(file => path.join(directory, file)).forEach(rmFile.sync)
  const removeUnloadCleanupHandler = unload.add(cleanup)

  const dockerfileSource = dockerfile.generate({ sshKey: Boolean(sshKey) })

  const hasDockerignore = await pathExists(path.join(directory, '.dockerignore'))
  const hasGitignore = await pathExists(path.join(directory, '.gitignore'))

  await writeFile(path.join(directory, 'scandium-dockerfile'), dockerfileSource)

  if (!hasDockerignore) {
    const ignore = hasGitignore ? await loadGitignoreFile(path.join(directory, '.gitignore')) : DEFAULT_IGNORE
    await writeFile(path.join(directory, '.dockerignore'), '.dockerignore\n' + ignore)
    cleanupFiles.push('.dockerignore')
  }

  let imageId
  if (sshKey) {
    const sshKeyPrivate = fs.readFileSync(sshKey).toString('base64')
    const sshKeyPublic = fs.readFileSync(`${sshKey}.pub`).toString('base64')
    imageId = await execa.stdout('docker', ['build', '--quiet', '--build-arg', 'SSH_PRIVATE_KEY', '--build-arg', 'SSH_PUBLIC_KEY', '--file', 'scandium-dockerfile', '.'], { cwd: directory, env: { SSH_PRIVATE_KEY: sshKeyPrivate, SSH_PUBLIC_KEY: sshKeyPublic } })
  } else {
    imageId = await execa.stdout('docker', ['build', '--quiet', '--file', 'scandium-dockerfile', '.'], { cwd: directory })
  }

  cleanup()
  removeUnloadCleanupHandler()

  const zipFile = await execa.stdout('docker', ['run', '--rm', imageId], { maxBuffer: bytes.parse('134mb') })

  return Buffer.from(zipFile, 'base64')
}

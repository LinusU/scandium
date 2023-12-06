import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import bytes from 'bytes'
import { execa } from 'execa'
import temp from 'fs-temp/promises'
import generateDockerignore from 'gitignore-to-dockerignore'
import { loadJsonFile } from 'load-json-file'
import { loadTextFile } from 'load-text-file'
import { pathExists } from 'path-exists'
import { rmFileSync } from 'rm-file'
import unload from 'unload'
import writeFile from 'write-file-atomically'

import { generateDockerfile } from './dockerfile.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

function writeJsonFile (path, data) {
  return writeFile(path, JSON.stringify(data, null, 2) + '\n')
}

const DEFAULT_IGNORE = ['.git/', 'node_modules/'].join('\n') + '\n'

export async function createZipFile (root, { customEntrypoint, directory, platform, skipNodeModules, sshKey }) {
  const appDirectory = directory ? path.join(root, directory) : root

  const cleanupFiles = []
  const removeUnloadCleanupHandler = unload.add(() => {
    for (const file of cleanupFiles) rmFileSync(path.join(appDirectory, file))
  })

  const hasYarnLockfile = await pathExists(path.join(appDirectory, 'yarn.lock'))

  const packageInfo = await loadJsonFile(path.join(appDirectory, 'package.json'))
  const packageLock = hasYarnLockfile ? null : await loadJsonFile(path.join(appDirectory, 'package-lock.json'))

  const cleanPackageInfo = Object.assign({}, packageInfo, { version: '0.0.0', scripts: undefined })
  const cleanPackageLock = hasYarnLockfile ? null : Object.assign({}, packageLock, { version: '0.0.0' })

  const hasBuildScript = Boolean(packageInfo.scripts && packageInfo.scripts.build)
  const hasPrepareScript = Boolean(packageInfo.scripts && packageInfo.scripts.prepare)
  const hasProductionDependencies = Boolean(packageInfo.dependencies && Object.keys(packageInfo.dependencies).length)
  const dockerfileSource = generateDockerfile({ directory, hasBuildScript, hasPrepareScript, hasProductionDependencies, skipNodeModules, sshKey: Boolean(sshKey), yarn: hasYarnLockfile })

  const hasDockerignore = await pathExists(path.join(root, '.dockerignore'))

  const dockerfilePath = path.join(await temp.mkdir(), 'Dockerfile')
  await writeFile(dockerfilePath, dockerfileSource)

  if (!customEntrypoint) {
    let entrypoint = await loadTextFile(path.join(dirname, '../entrypoint.js'))
    entrypoint = entrypoint.replace('{{MAIN_FILE}}', packageInfo.main || 'index.js')
    await writeFile(path.join(appDirectory, 'scandium-entrypoint.mjs'), entrypoint)
    cleanupFiles.push('scandium-entrypoint.mjs')
  }

  await writeJsonFile(path.join(appDirectory, 'scandium-clean-package.json'), cleanPackageInfo)
  cleanupFiles.push('scandium-clean-package.json')

  if (!hasYarnLockfile) {
    await writeJsonFile(path.join(appDirectory, 'scandium-clean-package-lock.json'), cleanPackageLock)
    cleanupFiles.push('scandium-clean-package-lock.json')
  }

  if (!hasDockerignore) {
    const ignore = DEFAULT_IGNORE + await generateDockerignore(root)
    await writeFile(`${dockerfilePath}.dockerignore`, ignore)
  }

  let imageId
  if (sshKey) {
    const sshKeyPrivate = fs.readFileSync(sshKey).toString('base64')
    const sshKeyPublic = fs.readFileSync(`${sshKey}.pub`).toString('base64')
    imageId = (await execa('docker', ['build', '--platform', platform, '--quiet', '--build-arg', 'SSH_PRIVATE_KEY', '--build-arg', 'SSH_PUBLIC_KEY', '--file', dockerfilePath, '.'], { cwd: root, env: { SSH_PRIVATE_KEY: sshKeyPrivate, SSH_PUBLIC_KEY: sshKeyPublic } })).stdout
  } else {
    imageId = (await execa('docker', ['build', '--platform', platform, '--quiet', '--file', dockerfilePath, '.'], { cwd: root })).stdout
  }

  removeUnloadCleanupHandler.run()

  const zipFile = (await execa('docker', ['run', '--platform', platform, '--rm', imageId], { maxBuffer: bytes.parse('134mb') })).stdout

  return Buffer.from(zipFile, 'base64')
}

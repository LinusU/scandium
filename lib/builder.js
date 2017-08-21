const fs = require('fs')
const path = require('path')

const cpFile = require('cp-file')
const execa = require('execa')
const loadJsonFile = require('load-json-file')
const rmFile = require('rm-file')

function writeJsonFile (path, data) {
  return new Promise((resolve, reject) => {
    fs.writeFile(path, JSON.stringify(data, null, 2), (err) => (err ? reject(err) : resolve()))
  })
}

exports.createZipFile = async function (directory) {
  const packageInfo = await loadJsonFile(path.join(directory, 'package.json'))
  const packageLock = await loadJsonFile(path.join(directory, 'package-lock.json'))

  const cleanPackageInfo = Object.assign({}, packageInfo, { version: '0.0.0', scripts: undefined })
  const cleanPackageLock = Object.assign({}, packageLock, { version: '0.0.0' })

  const hasPrepare = (packageInfo.scripts && packageInfo.scripts.prepare)
  const dockerfile = (hasPrepare ? 'prepare.txt' : 'plain.txt')

  await cpFile(path.join(__dirname, '../dockerfiles', dockerfile), path.join(directory, 'scandium-dockerfile'))
  await cpFile(path.join(__dirname, '../entrypoint.js'), path.join(directory, 'scandium-entrypoint.js'))

  await writeJsonFile(path.join(directory, 'scandium-clean-package.json'), cleanPackageInfo)
  await writeJsonFile(path.join(directory, 'scandium-clean-package-lock.json'), cleanPackageLock)

  const imageId = await execa.stdout('docker', ['build', '--quiet', '--file', 'scandium-dockerfile', '.'], { cwd: directory })
  const zipFile = await execa.stdout('docker', ['run', '--rm', imageId], { cwd: directory, maxBuffer: 50000000 })

  await rmFile(path.join(directory, 'scandium-dockerfile'))
  await rmFile(path.join(directory, 'scandium-entrypoint.js'))

  await rmFile(path.join(directory, 'scandium-clean-package.json'))
  await rmFile(path.join(directory, 'scandium-clean-package-lock.json'))

  return Buffer.from(zipFile, 'base64')
}

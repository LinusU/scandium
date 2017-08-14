const path = require('path')

const cpFile = require('cp-file')
const execa = require('execa')
const rmFile = require('rm-file')

exports.createZipFile = async function (directory) {
  await cpFile(path.join(__dirname, '../dockerfile.txt'), path.join(directory, 'scandium-dockerfile'))
  await cpFile(path.join(__dirname, '../entrypoint.js'), path.join(directory, 'scandium-entrypoint.js'))

  const imageId = await execa.stdout('docker', ['build', '--quiet', '--file', 'scandium-dockerfile', '.'], { cwd: directory })
  const zipFile = await execa.stdout('docker', ['run', '--rm', imageId], { cwd: directory })

  await rmFile(path.join(directory, 'scandium-dockerfile'))
  await rmFile(path.join(directory, 'scandium-entrypoint.js'))

  return Buffer.from(zipFile, 'base64')
}

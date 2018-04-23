/**
 * @param {object} options
 * @param {boolean} options.prepare
 * @param {boolean} options.yarn
 * @returns {string}
 */
exports.generate = function (options) {
  const { prepare, yarn } = options
  const lines = []

  // Base image on Amazon Linux
  lines.push('FROM amazonlinux:2017.03')

  // Install prerequisites
  lines.push('RUN yum install -y gcc gcc-c++ git make openssl-devel zip')
  lines.push('RUN curl https://nodejs.org/download/release/v8.10.0/node-v8.10.0-linux-x64.tar.gz | tar xz -C /usr --strip-components=1')

  // Install Yarn, if neccessary
  if (yarn) lines.push('RUN npm install -g yarn')

  // Set the workdir to same directory as Lambdas executes in
  // Some tools, e.g. Next.js, hard codes the path during the build phase.
  lines.push('WORKDIR /var/task')

  // Copy stripped package files
  // These files have the version stripped, so that docker can cache better.
  // Stripping is not needed on the yarn lockfile, as that doesn't include pacakge version.
  lines.push('COPY scandium-clean-package.json package.json')
  lines.push(`COPY ${yarn ? 'yarn.lock yarn.lock' : 'scandium-clean-package-lock.json package-lock.json'}`)

  // Add production dependencies
  // This step is run before adding the code, to increase docker cache use.
  lines.push(`RUN ${yarn ? 'yarn' : 'npm'} install --production`)
  lines.push('RUN zip -9qyr /output.zip node_modules')

  // Install dev-dependencies, if there is a `prepare` script present
  if (prepare) lines.push(`RUN ${yarn ? 'yarn' : 'npm'} install`)

  // Add the app files, and remove our special files
  lines.push('COPY . .')
  if (yarn) {
    lines.push('RUN rm scandium-clean-package.json scandium-dockerfile')
  } else {
    lines.push('RUN rm scandium-clean-package.json scandium-clean-package-lock.json scandium-dockerfile')
  }

  // Run the `prepare` script, if present
  if (prepare) lines.push('RUN npm run-script prepare')

  // Add the local code to the zip
  lines.push('RUN rm -r node_modules')
  lines.push('RUN zip -9qyrg /output.zip .')

  // Give the zip to the caller
  lines.push('CMD cat /output.zip | base64')

  return lines.join('\n')
}

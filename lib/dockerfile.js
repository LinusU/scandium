const githubPublicKey = 'github.com ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ=='
const sshPostfix = ' && unlink $HOME/.ssh/id_rsa && unlink $HOME/.ssh/id_rsa.pub'
const sshPrefix = 'echo $SSH_PRIVATE_KEY | base64 --decode > $HOME/.ssh/id_rsa && chmod 0600 $HOME/.ssh/id_rsa && echo $SSH_PUBLIC_KEY | base64 --decode > $HOME/.ssh/id_rsa.pub && '

const listNpmPackFiles = (
  // Run "npm pack" and parse output
  'JSON.parse(child_process.execSync("npm pack --dry-run --json").toString())' +
  // Extract list of files from output
  '[0].files.map(file => file.path)' +
  // Remove "scandium-entrypoint.mjs" if it exists
  '.filter(path => path !== "scandium-entrypoint.mjs")' +
  // Always add back "scandium-entrypoint.mjs"
  '.concat(["scandium-entrypoint.mjs"])' +
  // Output one line per file
  '.join("\\n")'
)

/**
 * @param {object} options
 * @param {string | null} options.directory
 * @param {boolean} options.hasBuildScript
 * @param {boolean} options.hasPrepareScript
 * @param {boolean} options.hasProductionDependencies
 * @param {boolean} options.skipNodeModules
 * @param {boolean} options.sshKey
 * @param {boolean} options.yarn
 * @returns {string}
 */
export function generateDockerfile (options) {
  const { hasBuildScript, hasPrepareScript, hasProductionDependencies, skipNodeModules, sshKey, yarn } = options
  const lines = []

  // Base image on Amazon Linux
  lines.push('FROM public.ecr.aws/lambda/nodejs:22.2025.05.04.04')

  // Install prerequisites
  lines.push('RUN dnf install -y gcc gcc-c++ git make openssl-devel tar zip')

  // Install package managers
  if (yarn) lines.push('RUN npm install -g yarn@1.22.22')

  // Set the workdir to same directory as Lambdas executes in
  // Some tools, e.g. Next.js, hard codes the path during the build phase.
  let directoryPrefix = ''
  if (options.directory) {
    lines.push(`WORKDIR /var/task/${options.directory}`)
    directoryPrefix = `${options.directory}/`
  } else {
    lines.push('WORKDIR /var/task')
  }

  // Add build argument for SSH key, and prime known_hosts with GitHub public key
  if (sshKey) lines.push('ARG SSH_PRIVATE_KEY', 'ARG SSH_PUBLIC_KEY', `RUN mkdir -p $HOME/.ssh && echo "${githubPublicKey}" >> $HOME/.ssh/known_hosts`)

  // Mount stripped package files
  // These files have the version stripped, so that docker can cache better.
  // Stripping is not needed on the yarn lockfile, as that doesn't include pacakge version.
  const packageFileMounts = [
    `--mount=type=bind,source=${directoryPrefix}scandium-clean-package.json,target=package.json`,
    `--mount=type=bind,source=${directoryPrefix}${yarn ? 'yarn.lock' : 'scandium-clean-package-lock.json'},target=${yarn ? 'yarn.lock' : 'package-lock.json'}`
  ].join(' ')

  // Add production dependencies
  // This step is run before adding the code, to increase docker cache use.
  if (hasProductionDependencies && !skipNodeModules) lines.push(`RUN ${packageFileMounts} ${sshKey ? sshPrefix : ''}${yarn ? 'yarn install --production --frozen-lockfile' : 'npm ci --production'}${sshKey ? sshPostfix : ''}`)
  if (hasProductionDependencies && !skipNodeModules) lines.push('RUN zip -9qyr /output.zip node_modules')

  // Install dev-dependencies, if there is a `prepare` or `build` script present
  if (hasPrepareScript || hasBuildScript) lines.push(`RUN ${packageFileMounts} ${sshKey ? sshPrefix : ''}${yarn ? 'yarn install --frozen-lockfile' : 'npm ci'}${sshKey ? sshPostfix : ''}`)

  // Add the app files, and remove our special files
  if (options.directory) {
    lines.push('WORKDIR /var/task')
    lines.push('COPY . .')
    lines.push(`WORKDIR /var/task/${options.directory}`)
  } else {
    lines.push('COPY . .')
  }
  if (yarn) {
    lines.push('RUN rm scandium-clean-package.json')
  } else {
    lines.push('RUN rm scandium-clean-package.json scandium-clean-package-lock.json')
  }

  // Run the `prepare` or `build` script, if present
  if (hasPrepareScript) lines.push('RUN npm run-script prepare')
  else if (hasBuildScript) lines.push('RUN npm run-script build')

  // Add the local code to the zip
  lines.push(`RUN node -p '${listNpmPackFiles}' | zip -9qyrg@ /output.zip`)

  // Give the zip to the caller
  lines.push('ENTRYPOINT []')
  lines.push('CMD cat /output.zip | base64')

  return lines.join('\n')
}

const githubPublicKey = 'github.com ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ=='

/**
 * @param {object} options
 * @param {boolean} options.sshKey
 * @returns {string}
 */
exports.generate = function (options) {
  const { sshKey } = options
  const lines = []

  // Base image on Amazon Linux
  lines.push('FROM amazonlinux:2.0.20191217.0')

  // Install prerequisites
  lines.push('RUN yum install -y gcc gcc-c++ git make openssl-devel tar zip')
  lines.push('RUN curl https://www.musl-libc.org/releases/musl-1.1.24.tar.gz | tar xzC /opt && cd /opt/musl-1.1.24 && ./configure && make && make install && cd /opt && rm -r musl-1.1.24')
  lines.push('RUN curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.40.0')
  lines.push('RUN . $HOME/.cargo/env && rustup target add x86_64-unknown-linux-musl')

  // Set the workdir to same directory as Lambdas executes in
  // Some tools, e.g. Next.js, hard codes the path during the build phase.
  lines.push('WORKDIR /var/task')

  // Copy stripped package files
  // These files have the version stripped, so that docker can cache better.
  // Stripping is not needed on the yarn lockfile, as that doesn't include pacakge version.
  // lines.push('COPY scandium-clean-Cargo.toml Cargo.toml')
  // lines.push('COPY scandium-clean-Cargo.lock Cargo.lock')
  lines.push('COPY Cargo.toml Cargo.toml')
  lines.push('COPY Cargo.lock Cargo.lock')
  lines.push('RUN mkdir src && echo "fn main() {}" > src/main.rs')

  // Add build argument for SSH key, and prime known_hosts with GitHub public key
  if (sshKey) lines.push('ARG SSH_PRIVATE_KEY', 'ARG SSH_PUBLIC_KEY', `RUN mkdir -p $HOME/.ssh && echo "${githubPublicKey}" >> $HOME/.ssh/known_hosts`)

  lines.push('RUN . $HOME/.cargo/env && PATH=/usr/local/musl/bin:$PATH cargo build --release --target x86_64-unknown-linux-musl')

  // Add the app files, and remove our special files
  lines.push('COPY . .')
  // lines.push('RUN rm scandium-clean-Cargo.toml scandium-clean-Cargo.lock scandium-dockerfile')
  lines.push('RUN rm scandium-dockerfile')
  lines.push('RUN . $HOME/.cargo/env && PATH=/usr/local/musl/bin:$PATH cargo build --release --target x86_64-unknown-linux-musl')

  // Add the local code to the zip
  lines.push('RUN mv target/x86_64-unknown-linux-musl/release/example-rust-api bootstrap')
  lines.push('RUN objcopy --strip-debug --strip-unneeded bootstrap')
  lines.push('RUN zip -9q /output.zip bootstrap')

  // Give the zip to the caller
  lines.push('CMD cat /output.zip | base64')

  return lines.join('\n')
}

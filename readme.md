# Scandium

> Easily deploy any Node.js web server to AWS Lambda.

Scandium can deploy your Express, Koa or similar app to lambda, without any modifications to your code. Combined with AWS API Gateway you can have your current API running serverless in no time 😎

## Prerequisites

Scandium requires [Node.js](https://nodejs.org/), [Docker](https://docs.docker.com/get-docker/), and a working [AWS config w/ credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html#cli-configure-files-where). If you are unfamiliar with the AWS config an easy way to get started is to [install the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html) and run `aws configure`.

<table>
<tr>
<td>

**macOS** w/ [Brew](https://brew.sh):

```sh
brew install node
brew cask install docker
brew install awscli
aws configure
```

</td>
<td>

**Linux** w/ [Snap](https://snapcraft.io):

```sh
sudo snap install node --classic
sudo snap install docker
sudo snap install aws-cli --classic
aws configure
```

</td>
<td>

**Windows** w/ [winget](https://github.com/microsoft/winget-cli):

```sh
winget install OpenJS.NodeJS
winget install Docker.DockerDesktop
winget install Amazon.AWSCLI
aws configure
```

</td>
</tr>
</table>

## Installation

```sh
npm install --global scandium
```

## Usage

To create a new Lambda function, use the `scandium create` command. This will package your application and upload it to AWS Lambda, as well as configure an API Gateway in front of your function.

```sh
scandium create --name=my-awesome-api
```

You should now be presented with a url where you can access your api.

> Now serving live requests at: https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/default

Whenever you make changes to your app, you can upload a new version of it by using the `scandium update` command. This will package your application again, and upload it as a new version to the specified Lambda function. It will also update the configuration of the API Gateway to point at the new function.

```sh
scandium update --name=my-awesome-api
```

## Tutorials

- [Deploying a Next.js app to AWS Lambda](https://medium.com/@LinusU/deploying-a-next-js-app-to-aws-lambda-4dcdd233f876)

## API Gateway

By default, Scandium will set up an API Gateway that simply forwards all requests to the Lambda function. If you want to utilise the benefits of API Gateway fully, you can provide a Swagger file describing your API endpoints. Pass the `--swagger=my-api-definition.yml` to either the `create` or `update` command and Scandium will configure the API Gateway for you.

## Application Load Balancer

The deployed entrypoint has support for being called from an application load balancer, as well as API Gateway. Note that  "Multi value headers" must be turned on in the load balancer target group for this to work.

There is currently no support in the Scandium CLI to automatically setup an ALB for you.

## `prepare`/`build`-scripts

Scandium has support for `prepare`/`build` scripts, if the script is present in the `package.json` it will make sure that the script is being run with full `devDependencies` installed. The final package being uploaded to Lambda will still only contain the production `dependencies`.

If both a `prepare` and a `build` script is present, Scandium will pick the `prepare` script.

## Ignore files

If there is a `.dockerignore` file present, that one will be used when building the app. Otherwise, if a `.gitignore` file is present, that one will be used. If none of these files exists, a built in list that just contains `.git` and `node_modules` will be used.

## Deploy Hooks

If you want to run any specific script inside the Lambda once during each deploy (e.g. for running database migrations), you can use the `--hooks` flag. Pass it the name of a file exporting functions for each hook you want to run.

Currently there is only one hook, named `deploy`, that will run after your Lambda is created, and before the API Gateway is updated to the new Lambda.

Example file:

```js
const runDatabaseMigrations = require('...')

exports.deploy = async function () {
  await runDatabaseMigrations()
}
```

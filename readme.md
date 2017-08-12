# Scandium

> Easily deploy any Node.js web server to AWS Lambda.

Scandium can deploy your Express, Koa or similar app to lambda, without any modifications to your code. Combined with AWS API Gateway you can have your current API running serverless in no time 😎

**note: This is very much a work in progress, don't expect anything to work right now**

## Installation

```sh
npm install --global scandium
```

## Usage

To create a new Lambda function, use the `scandium create` command. This will package your application and upload it to AWS Lambda.

```sh
scandium create my-awesome-api --role=arn:aws:iam::123:role/service-role/my-awesome-role
```

*note: Currently you have to specify a role, in the future one could be automatically created*

Whenever you make changes to your app, you can upload a new version of it by using the `scandium update` command. This will package your application again, and upload it as a new version to the specified Lambda function.

```sh
scandium update my-awesome-api
```

At this time, Scandium doesn't help you with setting up AWS API Gateway in front of the Lambda function. The easiset way to get started is to create a proxy resource at `/` that simply forwards all call to the function; but you could also model your entire api in AWS API Gateway and get all the benefits of that. Just let every method invoke the same Lambda function, it will automatically route depending on the incomming path.

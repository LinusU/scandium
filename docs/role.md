# Role

Currently you manually need to create a role for the Lambda to execute as. If you are using [Terraform](https://www.terraform.io) you can use the setup below:

```terraform
data "aws_caller_identity" "current" {}

data "aws_region" "current" {
  current = true
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "EXAMPLE_NAME" {
  statement {
    actions = ["logs:CreateLogGroup"]
    resources = ["arn:aws:logs:${data.aws_region.name}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${data.aws_region.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/EXAMPLE_NAME:*"]
  }

  statement {
    actions = ["ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces"]
    resources = ["*"]
  }
}

resource "aws_iam_role" "EXAMPLE_NAME" {
  name = "EXAMPLE_NAME"
  path = "/service-role/"
  assume_role_policy = "${data.aws_iam_policy_document.lambda_assume_role.json}"
}

resource "aws_iam_role_policy" "EXAMPLE_NAME" {
  name = "EXAMPLE_NAME"
  role = "${aws_iam_role.EXAMPLE_NAME.id}"
  policy = "${data.aws_iam_policy_document.EXAMPLE_NAME.json}"
}

output "EXAMPLE_NAME_role_arn" {
  value = "${aws_iam_role.EXAMPLE_NAME.arn}"
}
```

If you need your Lambda to access any services, simply add the required permissions as `statement` block in the `aws_iam_policy_document`.

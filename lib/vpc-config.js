import UserError from './user-error.js'

const re = /SubnetIds=(subnet-[0-9a-f]+(,subnet-[0-9a-f]+)*|\[\]),SecurityGroupIds=(sg-[0-9a-f]+(,sg-[0-9a-f]+)*|\[\])/

/**
 *
 * @param {string} input
 * @returns {import('@aws-sdk/client-lambda').VpcConfig}
 */
export function parseVpcConfig (input) {
  const match = re.exec(input)

  if (!match) {
    throw new UserError('Invalid VPC config: ' + input)
  }

  return {
    SubnetIds: match[1] === '[]' ? [] : match[1].split(','),
    SecurityGroupIds: match[3] === '[]' ? [] : match[3].split(',')
  }
}

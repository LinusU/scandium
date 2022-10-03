import assert from 'node:assert/strict'

import { parseVpcConfig } from './vpc-config.js'

assert.deepEqual(
  parseVpcConfig('SubnetIds=subnet-071f712345678e7c8,subnet-07fd123456788a036,SecurityGroupIds=sg-085912345678492fb'),
  {
    SubnetIds: [
      'subnet-071f712345678e7c8',
      'subnet-07fd123456788a036'
    ],
    SecurityGroupIds: [
      'sg-085912345678492fb'
    ]
  }
)

assert.deepEqual(
  parseVpcConfig('SubnetIds=subnet-071f712345678e7c8,SecurityGroupIds=sg-085912345678492fb'),
  {
    SubnetIds: [
      'subnet-071f712345678e7c8'
    ],
    SecurityGroupIds: [
      'sg-085912345678492fb'
    ]
  }
)

assert.deepEqual(
  parseVpcConfig('SubnetIds=subnet-071f712345678e7c8,SecurityGroupIds=sg-085912345678492fb,sg-085912345678492fc'),
  {
    SubnetIds: [
      'subnet-071f712345678e7c8'
    ],
    SecurityGroupIds: [
      'sg-085912345678492fb',
      'sg-085912345678492fc'
    ]
  }
)

assert.deepEqual(
  parseVpcConfig('SubnetIds=[],SecurityGroupIds=sg-085912345678492fb,sg-085912345678492fc'),
  {
    SubnetIds: [],
    SecurityGroupIds: [
      'sg-085912345678492fb',
      'sg-085912345678492fc'
    ]
  }
)

assert.deepEqual(
  parseVpcConfig('SubnetIds=subnet-071f712345678e7c8,SecurityGroupIds=[]'),
  {
    SubnetIds: [
      'subnet-071f712345678e7c8'
    ],
    SecurityGroupIds: []
  }
)

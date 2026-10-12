import {describe, expect, it} from 'vitest'
import {calculateSubnetCidrs, isCidrWithinBlock, isSubnetLayoutWithinBlock} from './network'
import type {SubnetGroupDef} from './network'

describe('subnet layout validation', () => {
  it('rejects the default four subnets in a /28 VPC', () => {
    const groups = [
      {name: 'public', count: 2, isPublic: true},
      {name: 'private', count: 2, isPublic: false},
    ]

    const preview = calculateSubnetCidrs('10.0.0.0/28', groups)

    expect(preview.flatMap((group) => group.cidrs)).toEqual([
      '10.0.0.0/28',
      '10.0.0.16/28',
      '10.0.0.32/28',
      '10.0.0.48/28',
    ])
    expect(isSubnetLayoutWithinBlock('10.0.0.0/28', groups)).toBe(false)
  })

  it('accepts one /28 subnet inside a /28 VPC', () => {
    const groups = [{name: 'public', count: 1, isPublic: true}]

    expect(isSubnetLayoutWithinBlock('10.0.0.0/28', groups)).toBe(true)
    expect(isCidrWithinBlock('10.0.0.0/28', '10.0.0.0/28')).toBe(true)
  })

  it('rejects a mixed-prefix plan whose second subnet is not aligned', () => {
    const groups = [
      {name: 'public', count: 1, isPublic: true, prefix: 28},
      {name: 'private', count: 1, isPublic: false, prefix: 27},
    ]

    expect(isSubnetLayoutWithinBlock('10.0.0.0/24', groups)).toBe(false)
  })

  it('accepts aligned mixed-prefix subnets', () => {
    const groups = [
      {name: 'public', count: 1, isPublic: true, prefix: 27},
      {name: 'private', count: 1, isPublic: false, prefix: 28},
    ]

    expect(isSubnetLayoutWithinBlock('10.0.0.0/24', groups)).toBe(true)
  })

  it.each([
    ['noncanonical VPC', '10.0.0.16/24', [{name: 'public', count: 1, isPublic: true, prefix: 28}]],
    ['invalid octet', '10.256.0.0/24', [{name: 'public', count: 1, isPublic: true}]],
    ['VPC prefix below /16', '10.0.0.0/15', [{name: 'public', count: 1, isPublic: true}]],
    ['VPC prefix above /28', '10.0.0.0/29', [{name: 'public', count: 1, isPublic: true}]],
    ['empty plan', '10.0.0.0/24', []],
    ['zero count', '10.0.0.0/24', [{name: 'public', count: 0, isPublic: true}]],
    ['fractional count', '10.0.0.0/24', [{name: 'public', count: 1.5, isPublic: true}]],
    ['oversized count', '10.0.0.0/24', [{name: 'public', count: Number.MAX_SAFE_INTEGER, isPublic: true}]],
    ['subnet larger than VPC', '10.0.0.0/24', [{name: 'public', count: 1, isPublic: true, prefix: 23}]],
    ['subnet smaller than /28', '10.0.0.0/24', [{name: 'public', count: 1, isPublic: true, prefix: 29}]],
  ] satisfies Array<[string, string, SubnetGroupDef[]]>)('rejects %s', (_, cidr, groups) => {
    expect(isSubnetLayoutWithinBlock(cidr, groups)).toBe(false)
  })
})

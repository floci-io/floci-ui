import {describe, expect, test} from 'bun:test'
import {AwsNetworkingAdapter} from './AwsNetworkingAdapter'
import {NotSupportedError} from '../cloud-spi/errors'
import type {Ec2Vpc} from '../services/ec2'

function vpc(overrides: Partial<Ec2Vpc> = {}): Ec2Vpc {
    return {
        vpcId: 'vpc-0a1b2c',
        cidrBlock: '10.0.0.0/16',
        state: 'available',
        isDefault: false,
        tags: [{key: 'Name', value: 'prod-vpc'}],
        ...overrides,
    }
}

function adapter(vpcs: Ec2Vpc[]): AwsNetworkingAdapter {
    return new AwsNetworkingAdapter({listVpcs: async () => vpcs})
}

describe('AwsNetworkingAdapter', () => {
    test('identifies itself as the AWS networking adapter', () => {
        const a = adapter([])

        expect(a.cloud).toBe('aws')
        expect(a.service).toBe('networking')
        expect(a.schema().cloud).toBe('aws')
        expect(a.schema().service).toBe('networking')
    })

    test('lists VPCs and maps the resource shape', async () => {
        const [resource] = await adapter([vpc()]).list()

        expect(resource).toEqual({
            id: 'vpc-0a1b2c',
            name: 'prod-vpc',
            cloud: 'aws',
            service: 'networking',
            type: 'vpc',
            region: null,
            createdAt: null,
            status: 'available',
            version: '10.0.0.0/16',
            metadata: {
                cidrBlock: '10.0.0.0/16',
                isDefault: false,
                tags: [{key: 'Name', value: 'prod-vpc'}],
            },
        })
    })

    test('falls back to the VPC id when there is no Name tag', async () => {
        const [resource] = await adapter([vpc({tags: [{key: 'Env', value: 'dev'}]})]).list()

        expect(resource?.name).toBe('vpc-0a1b2c')
    })

    test('reports a missing state as null rather than inventing one', async () => {
        const [resource] = await adapter([vpc({state: undefined})]).list()

        expect(resource?.status).toBeNull()
    })

    test('returns an empty list when the account has no VPCs', async () => {
        await expect(adapter([]).list()).resolves.toEqual([])
    })

    test('filters by search on the display name, case-insensitively', async () => {
        const a = adapter([
            vpc({vpcId: 'vpc-1', tags: [{key: 'Name', value: 'Prod-Network'}]}),
            vpc({vpcId: 'vpc-2', tags: [{key: 'Name', value: 'staging'}]}),
        ])

        const matches = await a.list({search: '  PROD '})

        expect(matches.map((r) => r.id)).toEqual(['vpc-1'])
    })

    test('treats a blank search as no filter', async () => {
        const a = adapter([vpc({vpcId: 'vpc-1'}), vpc({vpcId: 'vpc-2'})])

        await expect(a.list({search: '   '})).resolves.toHaveLength(2)
    })

    test('get returns the VPC with the matching id', async () => {
        const a = adapter([vpc({vpcId: 'vpc-1'}), vpc({vpcId: 'vpc-2', isDefault: true})])

        const resource = await a.get('vpc-2')

        expect(resource?.id).toBe('vpc-2')
        expect(resource?.metadata.isDefault).toBe(true)
    })

    test('get returns null for an unknown id', async () => {
        await expect(adapter([vpc()]).get('vpc-missing')).resolves.toBeNull()
    })

    test('create points the user at the Networking panel', async () => {
        const result = adapter([]).create({values: {}})

        await expect(result).rejects.toBeInstanceOf(NotSupportedError)
        await expect(result).rejects.toThrow('Networking panel')
    })

    test('delete points the user at the Networking panel', async () => {
        const result = adapter([vpc()]).delete('vpc-0a1b2c')

        await expect(result).rejects.toBeInstanceOf(NotSupportedError)
        await expect(result).rejects.toThrow('Networking panel')
    })

    test('propagates a failure from the EC2 service instead of swallowing it', async () => {
        const a = new AwsNetworkingAdapter({
            listVpcs: async () => {
                throw new Error('ec2 unreachable')
            },
        })

        await expect(a.list()).rejects.toThrow('ec2 unreachable')
        await expect(a.get('vpc-1')).rejects.toThrow('ec2 unreachable')
    })
})

import {describe, expect, test} from 'bun:test'
import {AwsComputeAdapter} from './AwsComputeAdapter'
import type {Ec2Image, Ec2Instance, RunInstanceInput} from '../services/ec2'

const baseInstance: Ec2Instance = {
    instanceId: 'i-0abc123def456',
    name: 'web-server-1',
    state: 'running',
    instanceType: 't3.micro',
    availabilityZone: 'us-east-1a',
    publicIpAddress: '54.1.2.3',
    privateIpAddress: '10.0.1.5',
    vpcId: 'vpc-abc',
    subnetId: 'subnet-abc',
    imageId: 'ami-0abcdef',
    keyName: 'my-key',
    launchTime: '2025-01-01T00:00:00.000Z',
    architecture: 'x86_64',
    platform: undefined,
    securityGroups: [{id: 'sg-abc', name: 'default'}],
    tags: [{key: 'Name', value: 'web-server-1'}],
}

function fakeService(overrides: Partial<{
    listInstances: () => Promise<Ec2Instance[]>
    describeInstance: (id: string) => Promise<Ec2Instance>
    terminateInstance: (id: string) => Promise<void>
    listAmis: () => Promise<Ec2Image[]>
    runInstance: (input: RunInstanceInput) => Promise<Ec2Instance>
}> = {}) {
    return {
        listInstances: async () => [baseInstance],
        describeInstance: async (_id: string) => baseInstance,
        terminateInstance: async (_id: string) => {},
        listAmis: async (): Promise<Ec2Image[]> => [],
        runInstance: async (_input: RunInstanceInput) => baseInstance,
        ...overrides,
    }
}

describe('AwsComputeAdapter', () => {
    test('list returns mapped CloudResource array', async () => {
        const adapter = new AwsComputeAdapter(fakeService())
        const result = await adapter.list()

        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('i-0abc123def456')
        expect(result[0].name).toBe('web-server-1')
        expect(result[0].cloud).toBe('aws')
        expect(result[0].service).toBe('compute')
        expect(result[0].type).toBe('instance')
        expect(result[0].status).toBe('running')
        expect(result[0].region).toBe('us-east-1a')
    })

    test('list filters results by search term', async () => {
        const adapter = new AwsComputeAdapter(fakeService({
            listInstances: async () => [
                baseInstance,
                {...baseInstance, instanceId: 'i-other', name: 'db-server-1'},
            ],
        }))

        const result = await adapter.list({search: 'web'})

        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('web-server-1')
    })

    test('list returns all instances when search is empty', async () => {
        const adapter = new AwsComputeAdapter(fakeService({
            listInstances: async () => [
                baseInstance,
                {...baseInstance, instanceId: 'i-other', name: 'db-server-1'},
            ],
        }))

        const result = await adapter.list({})

        expect(result).toHaveLength(2)
    })

    test('get returns null when instance has 404 http status', async () => {
        const err = Object.assign(new Error('Not found'), {$metadata: {httpStatusCode: 404}})
        const adapter = new AwsComputeAdapter(fakeService({
            describeInstance: async () => { throw err },
        }))

        const result = await adapter.get('i-missing')

        expect(result).toBeNull()
    })

    test('get rethrows non-404 errors', async () => {
        const err = Object.assign(new Error('InternalError'), {$metadata: {httpStatusCode: 500}})
        const adapter = new AwsComputeAdapter(fakeService({
            describeInstance: async () => { throw err },
        }))

        await expect(adapter.get('i-bad')).rejects.toThrow('InternalError')
    })

    test('get finds an AMI in the image listing instead of describing it as an instance', async () => {
        const described: string[] = []
        const adapter = new AwsComputeAdapter(fakeService({
            describeInstance: async (id) => { described.push(id); return baseInstance },
            listAmis: async () => [{imageId: 'ami-0abcdef1234567891', name: 'al2023-ami', state: 'available', architecture: 'x86_64', tags: []}],
        }))

        const result = await adapter.get('ami-0abcdef1234567891')

        expect(result?.type).toBe('image')
        expect(result?.name).toBe('al2023-ami')
        expect(result?.status).toBe('available')
        expect(result?.metadata?.architecture).toBe('x86_64')
        expect(described).toEqual([])
    })

    test('get returns null for an AMI that is not listed', async () => {
        const adapter = new AwsComputeAdapter(fakeService())

        expect(await adapter.get('ami-0000000000000000')).toBeNull()
    })

    test('create calls runInstance and returns mapped CloudResource', async () => {
        const launched: RunInstanceInput[] = []
        const adapter = new AwsComputeAdapter(fakeService({
            runInstance: async (input) => { launched.push(input); return baseInstance },
        }))
        const result = await adapter.create({values: {
            name: 'test-box',
            imageId: 'ami-0abcdef123',
            instanceType: 't3.micro',
            keyName: 'my-key',
            subnetId: 'subnet-abc',
            securityGroupIds: 'sg-111, sg-222',
        }})
        expect(launched).toHaveLength(1)
        expect(launched[0].name).toBe('test-box')
        expect(launched[0].imageId).toBe('ami-0abcdef123')
        expect(launched[0].instanceType).toBe('t3.micro')
        expect(launched[0].securityGroupIds).toEqual(['sg-111', 'sg-222'])
        expect(result.type).toBe('instance')
        expect(result.cloud).toBe('aws')
    })

    test('delete calls terminateInstance with the id', async () => {
        const terminated: string[] = []
        const adapter = new AwsComputeAdapter(fakeService({
            terminateInstance: async (id) => { terminated.push(id) },
        }))
        await adapter.delete('i-0abc123def456')
        expect(terminated).toEqual(['i-0abc123def456'])
    })

    test('schema returns aws compute schema', () => {
        const adapter = new AwsComputeAdapter(fakeService())
        const schema = adapter.schema()

        expect(schema.cloud).toBe('aws')
        expect(schema.service).toBe('compute')
        expect(schema.displayName).toBe('Compute')
        expect(schema.actions).toContain('list')
        expect(schema.actions).toContain('inspect')
    })
})

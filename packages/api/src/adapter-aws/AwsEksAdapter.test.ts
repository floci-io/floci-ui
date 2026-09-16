import {describe, expect, test} from 'bun:test'
import {AwsEksAdapter} from './AwsEksAdapter'

function fakeEksService() {
    return {
        listClusters: async () => [],
        describeCluster: async () => ({name: 'cluster-a', tags: {}}),
        listNodegroups: async (clusterName: string) => [{
            name: 'workers', clusterName, arn: 'arn:aws:eks:us-east-1:000000000000:nodegroup/cluster-a/workers/id',
            status: 'ACTIVE', version: '1.30', releaseVersion: '1.30.0-20260801',
            instanceTypes: ['t3.medium'], subnets: ['subnet-a'], nodeRole: 'arn:aws:iam::000000000000:role/workers',
            scalingConfig: {minSize: 1, desiredSize: 2, maxSize: 3}, labels: {workload: 'api'}, tags: {team: 'platform'},
        }],
        createNodegroup: async (clusterName: string, input: unknown) => ({
            name: (input as {name: string}).name, clusterName, instanceTypes: [], subnets: [], labels: {}, tags: {},
        }),
        deleteNodegroup: async () => ({name: 'workers', clusterName: 'cluster-a', instanceTypes: [], subnets: [], labels: {}, tags: {}}),
        listFargateProfiles: async (clusterName: string) => [{
            name: 'default', clusterName, arn: 'arn:aws:eks:us-east-1:000000000000:fargateprofile/cluster-a/default/id',
            status: 'ACTIVE', podExecutionRoleArn: 'arn:aws:iam::000000000000:role/fargate', subnets: ['subnet-a'],
            selectors: [{namespace: 'default', labels: {app: 'api'}}], tags: {team: 'platform'},
        }],
        createFargateProfile: async (clusterName: string, input: unknown) => ({
            name: (input as {name: string}).name, clusterName, subnets: [], selectors: [], tags: {},
        }),
        deleteFargateProfile: async () => ({name: 'default', clusterName: 'cluster-a', subnets: [], selectors: [], tags: {}}),
    }
}

describe('AwsEksAdapter', () => {
    test('maps EKS nodegroups through the provider-neutral contract', async () => {
        const adapter = new AwsEksAdapter(fakeEksService())

        await expect(adapter.listKubernetesNodegroups('cluster-a')).resolves.toEqual([expect.objectContaining({
            id: 'workers',
            clusterId: 'cluster-a',
            capacityType: null,
            scalingConfig: {minSize: 1, desiredSize: 2, maxSize: 3},
        })])
    })

    test('validates nodegroup input before calling the runtime', async () => {
        const adapter = new AwsEksAdapter(fakeEksService())

        await expect(adapter.createKubernetesNodegroup('cluster-a', {
            name: 'workers', nodeRole: '', subnets: ['subnet-a'],
        })).rejects.toThrow('Node role ARN is required')
    })

    test('maps EKS Fargate profiles through the provider-neutral contract', async () => {
        const adapter = new AwsEksAdapter(fakeEksService())

        await expect(adapter.listKubernetesFargateProfiles('cluster-a')).resolves.toEqual([expect.objectContaining({
            id: 'default',
            clusterId: 'cluster-a',
            selectors: [{namespace: 'default', labels: {app: 'api'}}],
        })])
    })

    test('validates that a Fargate profile has a selector namespace', async () => {
        const adapter = new AwsEksAdapter(fakeEksService())

        await expect(adapter.createKubernetesFargateProfile('cluster-a', {
            name: 'default', podExecutionRoleArn: 'arn:aws:iam::000000000000:role/fargate', selectors: [],
        })).rejects.toThrow('At least one selector namespace is required')
    })
})

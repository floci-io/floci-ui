import {
    CloudFormationClient,
    CreateStackCommand,
    DeleteStackCommand,
    DescribeStacksCommand,
    ListStackResourcesCommand,
    ListStacksCommand,
    type Stack,
    type StackResourceSummary,
    type StackSummary,
} from '@aws-sdk/client-cloudformation'
import {cloudformation as defaultCloudFormation} from '../aws'
import {awsCloudformationSchema} from '../cloud-spi/cloudformationSchema'
import {ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

export class AwsCloudFormationAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'iac' as const

    constructor(private readonly cloudformation: CloudFormationClient = defaultCloudFormation) {}

    schema(): ServiceSchema {
        return awsCloudformationSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const summaries: StackSummary[] = []
        let nextToken: string | undefined

        do {
            const res = await this.cloudformation.send(new ListStacksCommand({NextToken: nextToken}))
            summaries.push(...(res.StackSummaries ?? []))
            nextToken = res.NextToken
        } while (nextToken)

        return filterBySearch(summaries.map(summaryToResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const describe = await this.cloudformation.send(new DescribeStacksCommand({StackName: id}))
            const stack = describe.Stacks?.[0]
            if (!stack) return null

            const resourceSummaries: StackResourceSummary[] = []
            let nextToken: string | undefined
            do {
                const resources = await this.cloudformation.send(new ListStackResourcesCommand({StackName: id, NextToken: nextToken}))
                resourceSummaries.push(...(resources.StackResourceSummaries ?? []))
                nextToken = resources.NextToken
            } while (nextToken)

            return stackToResource(stack, resourceSummaries)
        } catch (error) {
            if (isStackNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const stackName = stringValue(input.values.stackName)
        const templateBody = stringValue(input.values.templateBody)
        if (!stackName) throw new ValidationError('stackName is required')
        if (!templateBody) throw new ValidationError('templateBody is required')

        const res = await this.cloudformation.send(new CreateStackCommand({StackName: stackName, TemplateBody: templateBody}))
        return {
            id: stackName,
            name: stackName,
            cloud: 'aws',
            service: 'iac',
            type: 'stack',
            region: null,
            createdAt: null,
            status: 'CREATE_IN_PROGRESS',
            metadata: {
                provider: 'aws',
                stackId: res.StackId,
            },
        }
    }

    async delete(id: string): Promise<void> {
        await this.cloudformation.send(new DeleteStackCommand({StackName: id}))
    }
}

function summaryToResource(summary: StackSummary): CloudResource {
    const id = summary.StackName ?? ''
    return {
        id,
        name: id,
        cloud: 'aws',
        service: 'iac',
        type: 'stack',
        region: null,
        createdAt: summary.CreationTime?.toISOString() ?? null,
        status: summary.StackStatus ?? null,
        metadata: {
            provider: 'aws',
            stackId: summary.StackId,
            lastUpdatedTime: summary.LastUpdatedTime?.toISOString(),
        },
    }
}

function stackToResource(stack: Stack, resources: StackResourceSummary[]): CloudResource {
    const id = stack.StackName ?? ''
    return {
        id,
        name: id,
        cloud: 'aws',
        service: 'iac',
        type: 'stack',
        region: null,
        createdAt: stack.CreationTime?.toISOString() ?? null,
        status: stack.StackStatus ?? null,
        metadata: {
            provider: 'aws',
            stackId: stack.StackId,
            description: stack.Description,
            lastUpdatedTime: stack.LastUpdatedTime?.toISOString(),
            capabilities: stack.Capabilities,
            enableTerminationProtection: stack.EnableTerminationProtection,
            outputs: (stack.Outputs ?? []).map((output) => ({
                key: output.OutputKey,
                value: output.OutputValue,
                description: output.Description,
            })),
            tags: (stack.Tags ?? []).map((tag) => ({key: tag.Key, value: tag.Value})),
            resources: resources.map((resource) => ({
                logicalId: resource.LogicalResourceId,
                physicalId: resource.PhysicalResourceId,
                resourceType: resource.ResourceType,
                status: resource.ResourceStatus,
            })),
        },
    }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

/**
 * DescribeStacks on a missing stack answers a 400 ValidationError with a
 * "does not exist" message rather than a 404 — verified against the local
 * Floci CloudFormation emulator, which matches real AWS behaviour.
 */
function isStackNotFound(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.name === 'ValidationError' && /does not exist/i.test(error.message)
}

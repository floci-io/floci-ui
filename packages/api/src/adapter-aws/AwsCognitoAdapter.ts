import {
    CreateUserPoolCommand,
    DeleteUserPoolCommand,
    DescribeUserPoolCommand,
    ListUserPoolsCommand,
    type CognitoIdentityProviderClient,
    type UserPoolDescriptionType,
    type UserPoolType,
} from '@aws-sdk/client-cognito-identity-provider'
import {
    awsCognitoSchema,
    COGNITO_POOL_NAME_MESSAGE,
    COGNITO_POOL_NAME_PATTERN,
} from '../cloud-spi/cognitoSchema'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const MAX_RESULTS = 60

export class AwsCognitoAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'cognito' as const

    constructor(private readonly cognito: CognitoIdentityProviderClient) {}

    schema(): ServiceSchema {
        return awsCognitoSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const pools: UserPoolDescriptionType[] = []
        let nextToken: string | undefined

        do {
            const response = await this.cognito.send(new ListUserPoolsCommand({
                MaxResults: MAX_RESULTS,
                NextToken: nextToken,
            }))
            pools.push(...(response.UserPools ?? []))
            nextToken = response.NextToken
        } while (nextToken)

        return filterBySearch(pools.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const response = await this.cognito.send(new DescribeUserPoolCommand({UserPoolId: id}))
            return response.UserPool ? toResource(response.UserPool) : null
        } catch (error) {
            if (isMissing(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const poolName = rawStringValue(input.values.poolName)
        if (!poolName) throw new ValidationError('poolName is required')
        if (!new RegExp(COGNITO_POOL_NAME_PATTERN).test(poolName)) {
            throw new ValidationError(COGNITO_POOL_NAME_MESSAGE)
        }

        const response = await this.cognito.send(new CreateUserPoolCommand({PoolName: poolName}))
        if (!response.UserPool?.Id) {
            throw new RuntimeError('AWS Cognito did not return the created user pool')
        }
        return toResource(response.UserPool)
    }

    async delete(id: string): Promise<void> {
        await this.cognito.send(new DeleteUserPoolCommand({UserPoolId: id}))
    }

    /** A one-item list avoids loading every pool for the frequently-polled service status. */
    async health(): Promise<void> {
        await this.cognito.send(new ListUserPoolsCommand({MaxResults: 1}))
    }
}

function toResource(pool: UserPoolDescriptionType | UserPoolType): CloudResource {
    const id = pool.Id ?? ''
    const detailed = pool as UserPoolType

    return {
        id,
        name: pool.Name ?? '',
        cloud: 'aws',
        service: 'cognito',
        type: 'user-pool',
        region: regionFromArn(detailed.Arn) ?? regionFromPoolId(id),
        createdAt: pool.CreationDate?.toISOString() ?? null,
        status: pool.Status ?? null,
        metadata: {
            provider: 'aws',
            identityService: 'cognito',
            arn: detailed.Arn,
            lastModifiedAt: pool.LastModifiedDate?.toISOString() ?? null,
            deletionProtection: detailed.DeletionProtection,
            estimatedNumberOfUsers: detailed.EstimatedNumberOfUsers,
            usernameAttributes: detailed.UsernameAttributes,
            aliasAttributes: detailed.AliasAttributes,
            autoVerifiedAttributes: detailed.AutoVerifiedAttributes,
        },
    }
}

function rawStringValue(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources

    return resources.filter(
        (resource) =>
            resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized),
    )
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

function regionFromPoolId(id: string): string | null {
    const separator = id.indexOf('_')
    if (separator <= 0) return null
    const candidate = id.slice(0, separator)
    return /^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(candidate) ? candidate : null
}

function isMissing(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    return (error as {name?: string}).name === 'ResourceNotFoundException'
}

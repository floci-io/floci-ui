import {
    CreateUserCommand,
    DeleteUserCommand,
    GetUserCommand,
    ListUsersCommand,
    type IAMClient,
    type User,
} from '@aws-sdk/client-iam'
import {iam as defaultIam} from '../aws'
import {
    awsIamSchema,
    IAM_PATH_MAX_LENGTH,
    IAM_PATH_MESSAGE,
    IAM_PATH_PATTERN,
    IAM_USER_NAME_MESSAGE,
    IAM_USER_NAME_PATTERN,
} from '../cloud-spi/iamSchema'
import {ConflictError, NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const MAX_LIST_PAGES = 50

export class AwsIamAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'identity' as const

    constructor(private readonly iam: IAMClient = defaultIam) {}

    schema(): ServiceSchema {
        return awsIamSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const users: User[] = []
        let marker: string | undefined
        let pages = 0

        do {
            const res = await this.iam.send(new ListUsersCommand({Marker: marker}))
            users.push(...(res.Users ?? []))
            marker = res.IsTruncated ? res.Marker : undefined
            pages += 1
        } while (marker && pages < MAX_LIST_PAGES)

        return filterBySearch(users.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const res = await this.iam.send(new GetUserCommand({UserName: id}))
            return res.User ? toResource(res.User) : null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const userName = stringValue(input.values.userName)
        const path = stringValue(input.values.path)
        if (!userName) throw new ValidationError('userName is required')
        if (!new RegExp(IAM_USER_NAME_PATTERN).test(userName)) throw new ValidationError(IAM_USER_NAME_MESSAGE)
        if (path && (path.length > IAM_PATH_MAX_LENGTH || !new RegExp(IAM_PATH_PATTERN).test(path))) {
            throw new ValidationError(IAM_PATH_MESSAGE)
        }

        const res = await this.iam.send(new CreateUserCommand({
            UserName: userName,
            Path: path || undefined,
        }))
        if (!res.User) throw new RuntimeError('AWS IAM did not return the created user')
        return toResource(res.User)
    }

    async delete(id: string): Promise<void> {
        try {
            await this.iam.send(new DeleteUserCommand({UserName: id}))
        } catch (error) {
            if (isNotFound(error)) throw new NotFoundError(`IAM user ${id} not found`, {cause: error})
            if (isDeleteConflict(error)) {
                throw new ConflictError(
                    `IAM user ${id} still has attached resources. Remove group memberships, access keys, `
                    + 'certificates, MFA devices, and policies before deleting the user.',
                    {cause: error},
                )
            }
            throw error
        }
    }
}

function toResource(user: User): CloudResource {
    const userName = user.UserName ?? ''
    return {
        id: userName,
        name: userName,
        cloud: 'aws',
        service: 'identity',
        type: 'iam-user',
        region: null,
        createdAt: user.CreateDate?.toISOString() ?? null,
        metadata: {
            provider: 'aws',
            identityService: 'iam',
            userId: user.UserId,
            arn: user.Arn,
            path: user.Path,
            permissionsBoundary: user.PermissionsBoundary,
            tags: user.Tags,
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

function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const candidate = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return candidate.name === 'NoSuchEntityException' || candidate.$metadata?.httpStatusCode === 404
}

function isDeleteConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    return (error as {name?: string}).name === 'DeleteConflictException'
}

import {
    CreateStateMachineCommand,
    DeleteStateMachineCommand,
    DescribeStateMachineCommand,
    type ExecutionListItem,
    GetExecutionHistoryCommand,
    type HistoryEvent,
    ListExecutionsCommand,
    ListStateMachinesCommand,
    type SFNClient,
    type StateMachineListItem,
} from '@aws-sdk/client-sfn'
import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    PageQuery,
} from '../cloud-spi/childCollections'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {STATE_MACHINE_NAME_PATTERN, awsWorkflowsSchema} from '../cloud-spi/workflowsSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to Step Functions — verified against Floci core 1.5.33.
 *
 * Notes from probing the runtime:
 *  - A missing state machine is `StateMachineDoesNotExist` with HTTP **400**, not
 *    404, so `get` matches on the error name. `awsErrors.ts` now maps that name so
 *    the route reports 404 rather than a validation failure.
 *  - `ListStateMachines` returns only the ARN, name, type and creation date — real
 *    Step Functions does the same. Status and definition live on
 *    `DescribeStateMachine`, so they are fetched on inspect only; doing it per row
 *    would make the table an N+1.
 *  - `CreateStateMachine` returns only an ARN and a date, so create describes the
 *    machine afterwards rather than synthesising a resource from its own input.
 *  - The runtime does validate the definition (`InvalidDefinition`), but its
 *    message is a JSON parser error, so the obvious problems are caught here with
 *    something more actionable.
 */
type DescribedMachine = {
    stateMachineArn?: string
    name?: string
    type?: string
    status?: string
    definition?: string
    roleArn?: string
    creationDate?: Date
    label?: string
    revisionId?: string
}

export class AwsStepFunctionsAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'workflows' as const

    readonly documents: DocumentStoreAdapter

    constructor(private readonly sfn: SFNClient) {
        this.documents = new StateMachineExecutionStore(sfn)
    }

    schema(): ServiceSchema {
        return awsWorkflowsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const machines: StateMachineListItem[] = []
        let nextToken: string | undefined

        do {
            const res = await this.sfn.send(new ListStateMachinesCommand(nextToken ? {nextToken} : {}))
            machines.push(...(res.stateMachines ?? []))
            nextToken = res.nextToken
        } while (nextToken)

        return filterBySearch(machines.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const res = await this.sfn.send(new DescribeStateMachineCommand({stateMachineArn: id}))
            return toResource(res as DescribedMachine)
        } catch (error) {
            if (isMissing(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(STATE_MACHINE_NAME_PATTERN).test(name)) {
            throw new ValidationError(
                'name must be up to 80 characters of letters, digits, hyphens and underscores',
            )
        }
        const roleArn = requiredString(input.values.roleArn, 'roleArn')
        if (!/^arn:aws[a-z-]*:iam::\d{12}:role\/.+$/.test(roleArn)) {
            throw new ValidationError('roleArn must be an IAM role ARN, e.g. arn:aws:iam::000000000000:role/my-role')
        }
        const definition = requiredDefinition(input.values.definition)

        const res = await this.sfn.send(new CreateStateMachineCommand({name, definition, roleArn}))
        const arn = res.stateMachineArn
        if (!arn) throw new RuntimeError(`Step Functions did not return an ARN for ${name}`)

        // create returns only the ARN, so read the machine back for the real shape.
        const created = await this.get(arn)
        if (!created) throw new RuntimeError(`State machine ${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        await this.sfn.send(new DeleteStateMachineCommand({stateMachineArn: id}))
    }
}

/**
 * Executions are the collection level and history events the leaf, so the
 * execution history viewer rides on the generic child-collections routes.
 *
 * Read-only on purpose. Step Functions has no DeleteExecution — an execution is
 * stopped, not removed — and a history event is immutable, so there is nothing
 * honest to put behind create/delete/put.
 */
class StateMachineExecutionStore implements DocumentStoreAdapter {
    constructor(private readonly sfn: SFNClient) {}

    async listCollections(resourceId: string, page: PageQuery = {}): Promise<CollectionPage<ChildCollection>> {
        // ListExecutions already returns the most recent execution first, which
        // is the order a history viewer wants.
        const res = await this.sfn.send(
            new ListExecutionsCommand({
                stateMachineArn: resourceId,
                maxResults: page.limit,
                nextToken: page.cursor,
            }),
        )
        return {
            items: (res.executions ?? []).map((execution) => toExecution(execution, resourceId)),
            nextCursor: res.nextToken ?? null,
        }
    }

    async listItems(resourceId: string, collectionId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        // GetExecutionHistory is addressed by the execution ARN alone, so unlike
        // CloudWatch Logs nothing on the runtime side ties the leaf to the
        // resource. Check the nesting here so the route cannot be used to read
        // an execution of a different state machine.
        if (!executionBelongsTo(collectionId, resourceId)) {
            throw new NotFoundError(`Execution ${collectionId} does not belong to state machine ${resourceId}`)
        }

        const res = await this.sfn.send(
            new GetExecutionHistoryCommand({
                executionArn: collectionId,
                // Oldest first, so the viewer reads top to bottom in the order
                // the states ran and paging forward continues the story.
                reverseOrder: false,
                includeExecutionData: true,
                maxResults: page.limit,
                nextToken: page.cursor,
            }),
        )
        return {
            items: (res.events ?? []).map((event) => toHistoryEvent(event, collectionId)),
            nextCursor: res.nextToken ?? null,
        }
    }
}

function toExecution(execution: ExecutionListItem, parentId: string): ChildCollection {
    const arn = execution.executionArn ?? ''
    const startedAt = execution.startDate?.toISOString() ?? null
    const stoppedAt = execution.stopDate?.toISOString() ?? null

    return {
        // The execution ARN is the identity: GetExecutionHistory takes one and a
        // name alone cannot address the execution.
        id: arn,
        name: execution.name ?? '',
        parentId,
        createdAt: startedAt,
        metadata: {
            arn,
            status: execution.status ?? null,
            startedAt,
            stoppedAt,
            durationMs:
                execution.startDate && execution.stopDate
                    ? execution.stopDate.getTime() - execution.startDate.getTime()
                    : null,
        },
    }
}

/**
 * A history event carries exactly one `*EventDetails` member, chosen by its
 * `type`. Surfacing that one object under a single `details` key gives the UI a
 * stable place to look instead of forty optional fields.
 */
function toHistoryEvent(event: HistoryEvent, collectionId: string): ChildItem {
    const details = Object.entries(event).find(
        ([key, value]) => key.endsWith('EventDetails') && value !== undefined && value !== null,
    )?.[1] as Record<string, unknown> | undefined

    return {
        // Event ids are 1-based and unique within an execution, so they are a
        // durable key — unlike log events, which have none.
        id: String(event.id ?? ''),
        collectionId,
        timestamp: event.timestamp?.toISOString() ?? null,
        body: {type: event.type ?? '', details: details ?? {}},
        metadata: {previousEventId: event.previousEventId ?? null},
    }
}

/**
 * `arn:aws:states:REGION:ACCOUNT:execution:MACHINE:NAME` (or `:express:` for an
 * Express workflow) nests under `arn:aws:states:REGION:ACCOUNT:stateMachine:MACHINE`
 * when the partition, region, account and machine name all agree.
 */
function executionBelongsTo(executionArn: string, stateMachineArn: string): boolean {
    const execution = executionArn.split(':')
    const machine = stateMachineArn.split(':')
    if (execution.length < 8 || machine.length < 7) return false
    if (!['execution', 'express'].includes(execution[5] ?? '')) return false

    return execution.slice(0, 5).join(':') === machine.slice(0, 5).join(':') && execution[6] === machine[6]
}

function toResource(machine: StateMachineListItem | DescribedMachine): CloudResource {
    const described = machine as DescribedMachine
    const arn = machine.stateMachineArn ?? ''

    return {
        // The ARN is the identity: Describe and Delete both take one, and a name
        // alone cannot address the machine. It survives the generic route because
        // HttpClient encodes path params.
        id: arn,
        name: machine.name ?? '',
        cloud: 'aws',
        service: 'workflows',
        type: 'state-machine',
        region: regionFromArn(arn),
        createdAt: machine.creationDate ? machine.creationDate.toISOString() : null,
        // Only DescribeStateMachine returns status, so this is null in a listing.
        status: described.status ?? null,
        metadata: {
            arn,
            /** `type` is taken by CloudResource, so the machine's own type is here. */
            machineType: machine.type,
            definition: described.definition,
            roleArn: described.roleArn,
            label: described.label,
            revisionId: described.revisionId,
        },
    }
}

/** `arn:aws:states:us-east-1:000000000000:stateMachine:name` — region is field 4. */
function regionFromArn(arn: string): string | null {
    return arn.split(':')[3] || null
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources

    return resources.filter(
        (resource) =>
            resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized),
    )
}

/**
 * Valid JSON is not a valid state machine. The runtime rejects a bad definition
 * with a JSON parser message; naming the missing field is more actionable.
 */
function requiredDefinition(value: unknown): string {
    const raw = requiredString(value, 'definition')

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new ValidationError('definition must be valid JSON')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ValidationError('definition must be a JSON object')
    }
    for (const field of ['StartAt', 'States'] as const) {
        if (!(field in parsed)) throw new ValidationError(`definition must contain ${field}`)
    }
    return raw
}

function isMissing(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    return (error as {name?: string}).name === 'StateMachineDoesNotExist'
}

function requiredString(value: unknown, field: string): string {
    if (value === undefined || value === null || value === '') throw new ValidationError(`${field} is required`)
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    const trimmed = value.trim()
    if (!trimmed) throw new ValidationError(`${field} is required`)
    return trimmed
}

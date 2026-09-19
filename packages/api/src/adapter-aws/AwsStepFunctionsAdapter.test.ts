import {describe, expect, test} from 'bun:test'
import {
    CreateStateMachineCommand,
    DeleteStateMachineCommand,
    DescribeStateMachineCommand,
    GetExecutionHistoryCommand,
    ListExecutionsCommand,
    ListStateMachinesCommand,
    type SFNClient,
} from '@aws-sdk/client-sfn'
import {AwsStepFunctionsAdapter} from './AwsStepFunctionsAdapter'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

function stubSfn(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as SFNClient
    return {client, sent}
}

const ARN = 'arn:aws:states:us-east-1:000000000000:stateMachine:orders'
const DEFINITION = `{
  "StartAt": "Done",
  "States": {
    "Done": {"Type": "Succeed"}
  }
}`
const ROLE = 'arn:aws:iam::000000000000:role/sfn'

const summary = {
    stateMachineArn: ARN,
    name: 'orders',
    type: 'STANDARD',
    creationDate: new Date('2026-07-28T10:00:00.000Z'),
}

const described = {
    ...summary,
    definition: DEFINITION,
    roleArn: ROLE,
    status: 'ACTIVE',
}

function runtimeStub() {
    return stubSfn((command) => {
        if (command instanceof ListStateMachinesCommand) return {stateMachines: [summary]}
        if (command instanceof DescribeStateMachineCommand) return described
        if (command instanceof CreateStateMachineCommand) return {stateMachineArn: ARN, creationDate: new Date()}
        return {}
    })
}

const validValues = {name: 'orders', roleArn: ROLE, definition: DEFINITION}

describe('AwsStepFunctionsAdapter', () => {
    test('identifies itself as the AWS workflows adapter', () => {
        const adapter = new AwsStepFunctionsAdapter(runtimeStub().client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('workflows')
        expect(adapter.schema().displayName).toBe('AWS Step Functions')
    })

    test('lists state machines from the summary alone', async () => {
        const {client, sent} = runtimeStub()
        const [resource] = await new AwsStepFunctionsAdapter(client).list()

        expect(sent[0]).toBeInstanceOf(ListStateMachinesCommand)
        expect(resource).toMatchObject({
            // The ARN is the id: DescribeStateMachine and DeleteStateMachine both
            // take one, and a name alone cannot address the machine.
            id: ARN,
            name: 'orders',
            cloud: 'aws',
            service: 'workflows',
            type: 'state-machine',
            region: 'us-east-1',
            createdAt: '2026-07-28T10:00:00.000Z',
        })
        expect(resource?.metadata.machineType).toBe('STANDARD')
    })

    test('does not describe each row while listing', async () => {
        // ListStateMachines omits status and definition, and real Step Functions
        // does too. Fetching them per row would make the table an N+1.
        const {client, sent} = runtimeStub()
        await new AwsStepFunctionsAdapter(client).list()

        expect(sent.some((c) => c instanceof DescribeStateMachineCommand)).toBe(false)
    })

    test('follows the pagination token', async () => {
        let call = 0
        const {client, sent} = stubSfn((command) => {
            if (!(command instanceof ListStateMachinesCommand)) return {}
            call += 1
            if (call === 1) return {stateMachines: [summary], nextToken: 'page-2'}
            return {stateMachines: [{...summary, name: 'refunds', stateMachineArn: `${ARN}-2`}]}
        })

        const resources = await new AwsStepFunctionsAdapter(client).list()

        expect(resources.map((r) => r.name)).toEqual(['orders', 'refunds'])
        expect((sent[1] as ListStateMachinesCommand).input.nextToken).toBe('page-2')
    })

    test('filters by name and ARN', async () => {
        const adapter = new AwsStepFunctionsAdapter(runtimeStub().client)

        await expect(adapter.list({search: 'ord'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'stateMachine:orders'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('inspects a state machine and surfaces the definition and status', async () => {
        const {client, sent} = runtimeStub()
        const resource = await new AwsStepFunctionsAdapter(client).get(ARN)

        expect((sent[0] as DescribeStateMachineCommand).input.stateMachineArn).toBe(ARN)
        // status is the canonical CloudResource field, not a metadata entry.
        expect(resource?.status).toBe('ACTIVE')
        expect(resource?.metadata).toMatchObject({definition: DEFINITION, roleArn: ROLE})
    })

    test('leaves status null in a listing, where the runtime does not return it', async () => {
        const {client} = runtimeStub()
        const [resource] = await new AwsStepFunctionsAdapter(client).list()

        expect(resource?.status).toBeNull()
    })

    test('returns null on StateMachineDoesNotExist even though the runtime answers 400', async () => {
        // Step Functions reports a missing machine as StateMachineDoesNotExist with
        // HTTP 400, not 404, so matching on the status would rethrow and show a
        // runtime error where an empty result belongs.
        const {client} = stubSfn(() => {
            throw Object.assign(new Error('State machine does not exist'), {
                name: 'StateMachineDoesNotExist',
                $metadata: {httpStatusCode: 400},
            })
        })
        await expect(new AwsStepFunctionsAdapter(client).get(ARN)).resolves.toBeNull()
    })

    test('rethrows a failure that is not a missing machine', async () => {
        const {client} = stubSfn(() => {
            throw Object.assign(new Error('AccessDenied'), {
                name: 'AccessDeniedException',
                $metadata: {httpStatusCode: 403},
            })
        })
        await expect(new AwsStepFunctionsAdapter(client).get(ARN)).rejects.toThrow('AccessDenied')
    })

    test('creates a state machine and reads it back', async () => {
        const {client, sent} = runtimeStub()
        const resource = await new AwsStepFunctionsAdapter(client).create({values: validValues})

        const command = sent[0] as CreateStateMachineCommand
        expect(command).toBeInstanceOf(CreateStateMachineCommand)
        expect(command.input.name).toBe('orders')
        expect(command.input.definition).toBe(DEFINITION)
        expect(command.input.definition).toContain('\n')
        expect(command.input.roleArn).toBe(ROLE)
        // create returns only an ARN, so the machine is described to build the
        // resource rather than synthesising one from the input.
        expect(sent[1]).toBeInstanceOf(DescribeStateMachineCommand)
        expect(resource.id).toBe(ARN)
    })

    test('requires the fields the schema marks required', async () => {
        const adapter = new AwsStepFunctionsAdapter(runtimeStub().client)

        const cases: Array<[Record<string, unknown>, string]> = [
            [{}, 'name is required'],
            [{name: 'orders'}, 'roleArn is required'],
            [{name: 'orders', roleArn: ROLE}, 'definition is required'],
        ]

        for (const [values, message] of cases) {
            await expect(adapter.create({values})).rejects.toThrow(new ValidationError(message))
        }
    })

    test('rejects a definition that is not JSON', async () => {
        const adapter = new AwsStepFunctionsAdapter(runtimeStub().client)

        await expect(adapter.create({values: {...validValues, definition: 'not json'}})).rejects.toThrow(
            ValidationError,
        )
    })

    test('rejects a definition missing StartAt or States', async () => {
        // Valid JSON is not a valid state machine. The runtime rejects it, but with
        // a parser message; naming the missing field is more actionable.
        const adapter = new AwsStepFunctionsAdapter(runtimeStub().client)

        await expect(adapter.create({values: {...validValues, definition: '{"States":{}}'}})).rejects.toThrow(
            new ValidationError('definition must contain StartAt'),
        )
        await expect(adapter.create({values: {...validValues, definition: '{"StartAt":"Done"}'}})).rejects.toThrow(
            new ValidationError('definition must contain States'),
        )
    })

    test('rejects a name or role ARN the runtime would refuse', async () => {
        const adapter = new AwsStepFunctionsAdapter(runtimeStub().client)

        await expect(adapter.create({values: {...validValues, name: 'has spaces'}})).rejects.toThrow(ValidationError)
        await expect(adapter.create({values: {...validValues, name: 'a'.repeat(81)}})).rejects.toThrow(ValidationError)
        await expect(adapter.create({values: {...validValues, roleArn: 'not-an-arn'}})).rejects.toThrow(ValidationError)
    })

    test('deletes a state machine by ARN', async () => {
        const {client, sent} = runtimeStub()
        await new AwsStepFunctionsAdapter(client).delete(ARN)

        expect((sent[0] as DeleteStateMachineCommand).input.stateMachineArn).toBe(ARN)
    })
})

const EXECUTION_ARN = 'arn:aws:states:us-east-1:000000000000:execution:orders:run-1'

const execution = {
    executionArn: EXECUTION_ARN,
    stateMachineArn: ARN,
    name: 'run-1',
    status: 'SUCCEEDED',
    startDate: new Date('2026-07-28T10:00:00.000Z'),
    stopDate: new Date('2026-07-28T10:00:02.500Z'),
}

const historyEvents = [
    {
        id: 1,
        type: 'ExecutionStarted',
        timestamp: new Date('2026-07-28T10:00:00.000Z'),
        previousEventId: 0,
        executionStartedEventDetails: {input: '{"orderId":"42"}', roleArn: ROLE},
    },
    {
        id: 2,
        type: 'PassStateEntered',
        timestamp: new Date('2026-07-28T10:00:01.000Z'),
        previousEventId: 1,
        stateEnteredEventDetails: {name: 'Done', input: '{"orderId":"42"}'},
    },
    {
        id: 3,
        type: 'ExecutionSucceeded',
        timestamp: new Date('2026-07-28T10:00:02.500Z'),
        previousEventId: 2,
        executionSucceededEventDetails: {output: '{"ok":true}'},
    },
]

function executionStub() {
    return stubSfn((command) => {
        if (command instanceof ListExecutionsCommand) return {executions: [execution]}
        if (command instanceof GetExecutionHistoryCommand) return {events: historyEvents}
        return {}
    })
}

describe('AwsStepFunctionsAdapter documents', () => {
    test('lists executions as collections addressed by ARN', async () => {
        const {client, sent} = executionStub()
        const page = await new AwsStepFunctionsAdapter(client).documents.listCollections(ARN)

        const command = sent[0] as ListExecutionsCommand
        expect(command).toBeInstanceOf(ListExecutionsCommand)
        expect(command.input.stateMachineArn).toBe(ARN)
        expect(page.nextCursor).toBeNull()
        expect(page.items).toEqual([
            {
                id: EXECUTION_ARN,
                name: 'run-1',
                parentId: ARN,
                createdAt: '2026-07-28T10:00:00.000Z',
                metadata: {
                    arn: EXECUTION_ARN,
                    status: 'SUCCEEDED',
                    startedAt: '2026-07-28T10:00:00.000Z',
                    stoppedAt: '2026-07-28T10:00:02.500Z',
                    durationMs: 2500,
                },
            },
        ])
    })

    test('a running execution has no stop date and no duration', async () => {
        const {client} = stubSfn(() => ({
            executions: [{...execution, status: 'RUNNING', stopDate: undefined}],
        }))
        const page = await new AwsStepFunctionsAdapter(client).documents.listCollections(ARN)

        expect(page.items[0]?.metadata).toMatchObject({status: 'RUNNING', stoppedAt: null, durationMs: null})
    })

    test('passes the page size and cursor through and returns the next token', async () => {
        const {client, sent} = stubSfn(() => ({executions: [execution], nextToken: 'page-2'}))
        const page = await new AwsStepFunctionsAdapter(client).documents.listCollections(ARN, {
            limit: 25,
            cursor: 'page-1',
        })

        const command = sent[0] as ListExecutionsCommand
        expect(command.input.maxResults).toBe(25)
        expect(command.input.nextToken).toBe('page-1')
        expect(page.nextCursor).toBe('page-2')
    })

    test('reads the execution history as items, oldest first, with one details object per event', async () => {
        const {client, sent} = executionStub()
        const page = await new AwsStepFunctionsAdapter(client).documents.listItems(ARN, EXECUTION_ARN)

        const command = sent[0] as GetExecutionHistoryCommand
        expect(command).toBeInstanceOf(GetExecutionHistoryCommand)
        expect(command.input.executionArn).toBe(EXECUTION_ARN)
        expect(command.input.reverseOrder).toBe(false)
        // Without this the runtime omits input/output, which is what the viewer is for.
        expect(command.input.includeExecutionData).toBe(true)

        expect(page.nextCursor).toBeNull()
        expect(page.items.map((item) => item.id)).toEqual(['1', '2', '3'])
        expect(page.items[1]).toEqual({
            id: '2',
            collectionId: EXECUTION_ARN,
            timestamp: '2026-07-28T10:00:01.000Z',
            body: {type: 'PassStateEntered', details: {name: 'Done', input: '{"orderId":"42"}'}},
            metadata: {previousEventId: 1},
        })
    })

    test('an event with no details still has an empty details object', async () => {
        const {client} = stubSfn(() => ({
            events: [{id: 7, type: 'ExecutionAborted', timestamp: new Date('2026-07-28T10:00:03.000Z')}],
        }))
        const page = await new AwsStepFunctionsAdapter(client).documents.listItems(ARN, EXECUTION_ARN)

        expect(page.items[0]?.body).toEqual({type: 'ExecutionAborted', details: {}})
        expect(page.items[0]?.metadata).toEqual({previousEventId: null})
    })

    test('pages history forward with the cursor', async () => {
        const {client, sent} = stubSfn(() => ({events: historyEvents, nextToken: 'more'}))
        const page = await new AwsStepFunctionsAdapter(client).documents.listItems(ARN, EXECUTION_ARN, {
            limit: 3,
            cursor: 'start',
        })

        const command = sent[0] as GetExecutionHistoryCommand
        expect(command.input.maxResults).toBe(3)
        expect(command.input.nextToken).toBe('start')
        expect(page.nextCursor).toBe('more')
    })

    test('accepts an Express execution ARN under its state machine', async () => {
        const {client, sent} = executionStub()
        const expressArn = 'arn:aws:states:us-east-1:000000000000:express:orders:run-1:0f1e2d3c'
        await new AwsStepFunctionsAdapter(client).documents.listItems(ARN, expressArn)

        expect((sent[0] as GetExecutionHistoryCommand).input.executionArn).toBe(expressArn)
    })

    test('refuses to read an execution of a different state machine', async () => {
        // GetExecutionHistory is addressed by the execution ARN alone, so the
        // adapter has to enforce the resource → collection nesting itself.
        const {client, sent} = executionStub()
        const adapter = new AwsStepFunctionsAdapter(client)
        const foreign = 'arn:aws:states:us-east-1:000000000000:execution:refunds:run-1'

        await expect(adapter.documents.listItems(ARN, foreign)).rejects.toThrow(NotFoundError)
        await expect(adapter.documents.listItems(ARN, 'not-an-arn')).rejects.toThrow(NotFoundError)
        expect(sent).toHaveLength(0)
    })

    test('the store is read-only', () => {
        // No DeleteExecution exists (executions are stopped, not removed) and
        // history events are immutable, so nothing is advertised that cannot be done.
        const adapter = new AwsStepFunctionsAdapter(executionStub().client)

        expect(adapter.documents.createCollection).toBeUndefined()
        expect(adapter.documents.deleteCollection).toBeUndefined()
        expect(adapter.documents.putItem).toBeUndefined()
        expect(adapter.documents.deleteItem).toBeUndefined()
        expect(adapter.documents.queryItems).toBeUndefined()
    })
})

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {ReactElement} from 'react'
import {WorkflowExecutionsPanel} from '@/components/WorkflowExecutionsPanel'
import type {ChildCollection, ChildItem, CloudResource, CollectionPage} from '@/types/resource'

const {listChildCollections, listCollectionItems} = vi.hoisted(() => ({
    listChildCollections: vi.fn(),
    listCollectionItems: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', () => ({listChildCollections, listCollectionItems}))

const MACHINE_ARN = 'arn:aws:states:us-east-1:000000000000:stateMachine:orders'
const EXECUTION_ARN = 'arn:aws:states:us-east-1:000000000000:execution:orders:run-1'

const machine: CloudResource = {
    id: MACHINE_ARN,
    name: 'orders',
    cloud: 'aws',
    service: 'workflows',
    type: 'state-machine',
    region: 'us-east-1',
    createdAt: '2026-07-28T10:00:00.000Z',
    metadata: {arn: MACHINE_ARN},
}

const executions: CollectionPage<ChildCollection> = {
    items: [
        {
            id: EXECUTION_ARN,
            name: 'run-1',
            parentId: MACHINE_ARN,
            createdAt: '2026-07-28T10:00:00.000Z',
            metadata: {
                arn: EXECUTION_ARN,
                status: 'SUCCEEDED',
                startedAt: '2026-07-28T10:00:00.000Z',
                stoppedAt: '2026-07-28T10:00:02.500Z',
                durationMs: 2500,
            },
        },
        {
            id: `${EXECUTION_ARN.slice(0, -1)}2`,
            name: 'run-2',
            parentId: MACHINE_ARN,
            createdAt: '2026-07-28T11:00:00.000Z',
            metadata: {status: 'RUNNING', startedAt: '2026-07-28T11:00:00.000Z', stoppedAt: null, durationMs: null},
        },
    ],
    nextCursor: null,
}

const history: CollectionPage<ChildItem> = {
    items: [
        {
            id: '1',
            collectionId: EXECUTION_ARN,
            timestamp: '2026-07-28T10:00:00.000Z',
            body: {type: 'ExecutionStarted', details: {input: '{"orderId":"42"}'}},
            metadata: {previousEventId: 0},
        },
        {
            id: '2',
            collectionId: EXECUTION_ARN,
            timestamp: '2026-07-28T10:00:01.000Z',
            body: {type: 'PassStateEntered', details: {name: 'Done', input: '{"orderId":"42"}'}},
            metadata: {previousEventId: 1},
        },
    ],
    nextCursor: null,
}

function renderPanel(ui: ReactElement) {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
    listChildCollections.mockReset()
    listCollectionItems.mockReset()
    listChildCollections.mockResolvedValue(executions)
    listCollectionItems.mockResolvedValue(history)
})

describe('WorkflowExecutionsPanel', () => {
    it('asks for a state machine before loading anything', () => {
        renderPanel(<WorkflowExecutionsPanel cloud="aws" runtimeReachable/>)

        expect(screen.getByText('Select a state machine')).toBeInTheDocument()
        expect(listChildCollections).not.toHaveBeenCalled()
    })

    it('lists the executions of the selected state machine with their status', async () => {
        renderPanel(<WorkflowExecutionsPanel cloud="aws" resource={machine} runtimeReachable/>)

        expect(await screen.findByText('run-1')).toBeInTheDocument()
        expect(screen.getByText('run-2')).toBeInTheDocument()
        expect(screen.getByText('SUCCEEDED')).toBeInTheDocument()
        expect(screen.getByText('RUNNING')).toBeInTheDocument()
        expect(screen.getByText(/2\.5 s/)).toBeInTheDocument()
        expect(screen.getByText(/in progress/)).toBeInTheDocument()

        expect(listChildCollections).toHaveBeenCalledWith('aws', 'workflows', MACHINE_ARN, undefined, expect.anything())
        // History is scoped to one execution, so nothing is fetched until one is picked.
        expect(listCollectionItems).not.toHaveBeenCalled()
        expect(screen.getByRole('heading', {name: 'Select an execution'})).toBeInTheDocument()
    })

    it('does not call the runtime while it is unreachable', () => {
        renderPanel(<WorkflowExecutionsPanel cloud="aws" resource={machine} runtimeReachable={false}/>)

        expect(listChildCollections).not.toHaveBeenCalled()
        for (const button of screen.getAllByRole('button', {name: /refresh/i})) expect(button).toBeDisabled()
    })

    it('shows the history of a clicked execution and expands an event to its details', async () => {
        const user = userEvent.setup()
        renderPanel(<WorkflowExecutionsPanel cloud="aws" resource={machine} runtimeReachable/>)

        await user.click(await screen.findByText('run-1'))

        const table = await screen.findByRole('table')
        expect(listCollectionItems).toHaveBeenCalledWith(
            'aws',
            'workflows',
            MACHINE_ARN,
            EXECUTION_ARN,
            undefined,
            expect.anything(),
        )
        expect(within(table).getByText('ExecutionStarted')).toBeInTheDocument()
        expect(within(table).getByText('PassStateEntered')).toBeInTheDocument()
        // The one-line summary names the state; the JSON is hidden until expanded.
        expect(within(table).getByText('Done')).toBeInTheDocument()
        expect(within(table).queryByText(/"orderId"/)).not.toBeInTheDocument()

        await user.click(within(table).getAllByRole('button', {name: /expand event details/i})[1]!)

        expect(within(table).getByText(/"orderId": "42"/)).toBeInTheDocument()
    })

    it('offers to load the next page when the runtime returns a cursor', async () => {
        const user = userEvent.setup()
        listChildCollections
            .mockResolvedValueOnce({...executions, nextCursor: 'page-2'})
            .mockResolvedValueOnce({items: [{...executions.items[0]!, id: 'x', name: 'run-3'}], nextCursor: null})
        renderPanel(<WorkflowExecutionsPanel cloud="aws" resource={machine} runtimeReachable/>)

        await user.click(await screen.findByRole('button', {name: 'Load more'}))

        expect(await screen.findByText('run-3')).toBeInTheDocument()
        expect(listChildCollections).toHaveBeenLastCalledWith('aws', 'workflows', MACHINE_ARN, 'page-2', expect.anything())
        expect(screen.queryByRole('button', {name: 'Load more'})).not.toBeInTheDocument()
    })
})

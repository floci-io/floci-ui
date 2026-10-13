import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {ReactElement} from 'react'
import {DynamoDbTableExplorer} from '@/components/DynamoDbTableExplorer'
import type {ChildItem, CloudResource, CollectionPage} from '@/types/resource'

const {listFlatItems, putFlatItem, queryFlatItems} = vi.hoisted(() => ({
    listFlatItems: vi.fn(),
    putFlatItem: vi.fn(),
    queryFlatItems: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', () => ({listFlatItems, putFlatItem, queryFlatItems}))

function table(id: string): CloudResource {
    return {
        id,
        name: id,
        cloud: 'aws',
        service: 'nosql',
        type: 'dynamodb-table',
        region: 'us-east-1',
        createdAt: null,
        metadata: {keySchema: [{AttributeName: 'id', KeyType: 'HASH'}], attributeDefinitions: [{AttributeName: 'id', AttributeType: 'S'}]},
    }
}

function item(body: Record<string, unknown>): ChildItem {
    const key = {id: body.id}
    return {id: JSON.stringify(key), collectionId: null, timestamp: null, body, metadata: {key}}
}

function page(items: ChildItem[], nextCursor: string | null = null): CollectionPage<ChildItem> {
    return {items, nextCursor}
}

function renderExplorer(ui: ReactElement) {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
    return {...view, rerender: (next: ReactElement) => view.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>)}
}

afterEach(() => {
    vi.clearAllMocks()
})

describe('DynamoDbTableExplorer', () => {
    beforeEach(() => {
        listFlatItems.mockResolvedValue(page([item({id: 'order-1'})]))
    })

    test('scans the selected table through the flat item store', async () => {
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)

        expect(await screen.findByRole('cell', {name: '{"id":"order-1"}'})).toBeInTheDocument()
        expect(listFlatItems).toHaveBeenCalledWith('aws', 'nosql', 'orders', undefined, expect.any(AbortSignal))
    })

    test('runs the trimmed statement on Ctrl+Enter', async () => {
        queryFlatItems.mockResolvedValue(page([item({id: 'order-1', total: 3})]))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)

        const editor = screen.getByRole('textbox', {name: 'PartiQL statement'})
        await user.clear(editor)
        await user.type(editor, '  SELECT total FROM "orders"  ')
        await user.keyboard('{Control>}{Enter}{/Control}')

        expect(await screen.findByText('1 row')).toBeInTheDocument()
        expect(queryFlatItems).toHaveBeenCalledWith('aws', 'nosql', 'orders', 'SELECT total FROM "orders"', undefined)
    })

    test('continues the statement that produced the cursor, not the edited text', async () => {
        queryFlatItems
            .mockResolvedValueOnce(page([item({id: 'order-1'})], 'token-2'))
            .mockResolvedValueOnce(page([item({id: 'order-2'})]))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)

        await user.click(screen.getByRole('button', {name: 'Run statement'}))
        await screen.findByText('1+ row')
        const editor = screen.getByRole('textbox', {name: 'PartiQL statement'})
        await user.clear(editor)
        await user.type(editor, 'SELECT * FROM "other"')
        await user.click(screen.getByRole('button', {name: 'Load more rows'}))

        expect(await screen.findByText('2 rows')).toBeInTheDocument()
        expect(queryFlatItems).toHaveBeenLastCalledWith('aws', 'nosql', 'orders', 'SELECT * FROM "orders"', 'token-2')
    })

    test('resets the editor and its results when the table changes', async () => {
        queryFlatItems.mockResolvedValue(page([item({id: 'order-1'})]))
        const user = userEvent.setup()
        const {rerender} = renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)

        await user.click(screen.getByRole('button', {name: 'Run statement'}))
        await screen.findByText('1 row')
        rerender(<DynamoDbTableExplorer cloud="aws" resource={table('invoices')} runtimeReachable/>)

        expect(screen.getByRole('textbox', {name: 'PartiQL statement'})).toHaveValue('SELECT * FROM "invoices"')
        expect(screen.queryByText('1 row')).not.toBeInTheDocument()
    })

    test('does not run statements while the runtime is unreachable', async () => {
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable={false}/>)

        expect(screen.getByRole('button', {name: 'Run statement'})).toBeDisabled()
        await user.type(screen.getByRole('textbox', {name: 'PartiQL statement'}), '{Control>}{Enter}{/Control}')

        expect(queryFlatItems).not.toHaveBeenCalled()
        expect(listFlatItems).not.toHaveBeenCalled()
    })

    test.each([
        ['INSERT', 'INSERT INTO "orders" VALUE {\'id\': \'order-2\'}'],
        ['UPDATE', 'UPDATE "orders" SET total = 1 WHERE id = \'order-1\''],
        ['DELETE', 'DELETE FROM "orders" WHERE id = \'order-1\''],
    ])('rescans the records after a %s statement', async (_verb, statement) => {
        queryFlatItems.mockResolvedValue(page([]))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)
        await screen.findByRole('cell', {name: '{"id":"order-1"}'})
        const scansBefore = listFlatItems.mock.calls.length

        const editor = screen.getByRole('textbox', {name: 'PartiQL statement'})
        await user.clear(editor)
        await user.type(editor, statement.replace(/[{]/g, '{{'))
        await user.click(screen.getByRole('button', {name: 'Run statement'}))

        await waitFor(() => expect(listFlatItems.mock.calls.length).toBeGreaterThan(scansBefore))
    })

    test('does not rescan the records after a SELECT, even in lower case', async () => {
        queryFlatItems.mockResolvedValue(page([item({id: 'order-1'})]))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)
        await screen.findByRole('cell', {name: '{"id":"order-1"}'})
        const scansBefore = listFlatItems.mock.calls.length

        const editor = screen.getByRole('textbox', {name: 'PartiQL statement'})
        await user.clear(editor)
        await user.type(editor, 'select * from "orders"')
        await user.click(screen.getByRole('button', {name: 'Run statement'}))
        await screen.findByText('1 row')

        expect(listFlatItems.mock.calls.length).toBe(scansBefore)
    })

    test('shows the statement error and no stale rows', async () => {
        queryFlatItems.mockRejectedValue(new Error("Statement wasn't well formed (invalid_request)"))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)

        await user.click(screen.getByRole('button', {name: 'Run statement'}))

        expect(await screen.findByText("Statement wasn't well formed (invalid_request)")).toBeInTheDocument()
        expect(screen.queryByText(/rows?$/)).not.toBeInTheDocument()
    })

    test('appends the next page of rows to the ones already shown', async () => {
        queryFlatItems
            .mockResolvedValueOnce(page([item({id: 'order-1', total: 3})], 'token-2'))
            .mockResolvedValueOnce(page([item({id: 'order-2', total: 5})]))
        const user = userEvent.setup()
        const {container} = renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)

        await user.click(screen.getByRole('button', {name: 'Run statement'}))
        await screen.findByText('1+ row')
        await user.click(screen.getByRole('button', {name: 'Load more rows'}))
        await screen.findByText('2 rows')

        const rows = JSON.parse(container.querySelector('.cosmos-query-result')!.textContent!)
        expect(rows).toEqual([{id: 'order-1', total: 3}, {id: 'order-2', total: 5}])
        expect(screen.queryByRole('button', {name: 'Load more rows'})).not.toBeInTheDocument()
    })

    test('disables Run statement while the statement is blank', async () => {
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)
        const editor = screen.getByRole('textbox', {name: 'PartiQL statement'})
        const run = screen.getByRole('button', {name: 'Run statement'})

        expect(run).toBeEnabled()
        await user.clear(editor)
        expect(run).toBeDisabled()
        await user.type(editor, '   ')
        expect(run).toBeDisabled()
        await user.keyboard('{Control>}{Enter}{/Control}')

        expect(queryFlatItems).not.toHaveBeenCalled()
    })

    test('does not refetch the loaded pages when the window regains focus', async () => {
        listFlatItems
            .mockResolvedValueOnce(page([item({id: 'order-1'})], 'token-2'))
            .mockResolvedValueOnce(page([item({id: 'order-2'})]))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)
        await screen.findByRole('cell', {name: '{"id":"order-1"}'})
        await user.click(screen.getByRole('button', {name: 'Load more'}))
        await screen.findByRole('cell', {name: '{"id":"order-2"}'})
        const scans = listFlatItems.mock.calls.length

        window.dispatchEvent(new Event('visibilitychange'))
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(listFlatItems.mock.calls.length).toBe(scans)
    })

    test('retries a failed page without dropping the pages already loaded', async () => {
        listFlatItems
            .mockResolvedValueOnce(page([item({id: 'order-1'})], 'token-2'))
            .mockRejectedValueOnce(new Error('scan failed'))
            .mockResolvedValueOnce(page([item({id: 'order-2'})]))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)
        await screen.findByRole('cell', {name: '{"id":"order-1"}'})
        await user.click(screen.getByRole('button', {name: 'Load more'}))

        expect(await screen.findByText('scan failed')).toBeInTheDocument()
        expect(screen.getByRole('cell', {name: '{"id":"order-1"}'})).toBeInTheDocument()
        await user.click(screen.getByRole('button', {name: 'Retry'}))

        expect(await screen.findByRole('cell', {name: '{"id":"order-2"}'})).toBeInTheDocument()
        expect(screen.getByRole('cell', {name: '{"id":"order-1"}'})).toBeInTheDocument()
        expect(screen.queryByText('scan failed')).not.toBeInTheDocument()
    })
    test('does not continue the old cursor chain while a refresh is in flight', async () => {
        let finishRefresh: ((value: CollectionPage<ChildItem>) => void) | undefined
        listFlatItems
            .mockResolvedValueOnce(page([item({id: 'order-1'})], 'old-token'))
            .mockReturnValueOnce(new Promise((resolve) => {
                finishRefresh = resolve
            }))
            .mockResolvedValueOnce(page([item({id: 'order-2'})]))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={table('orders')} runtimeReachable/>)
        await screen.findByRole('cell', {name: '{"id":"order-1"}'})

        await user.click(screen.getByRole('button', {name: 'Refresh'}))
        const loadMore = screen.getByRole('button', {name: 'Load more'})
        expect(loadMore).toBeDisabled()
        await user.click(loadMore)
        expect(listFlatItems).toHaveBeenCalledTimes(2)

        finishRefresh?.(page([item({id: 'order-1'})], 'new-token'))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Load more'})).toBeEnabled())
        await user.click(screen.getByRole('button', {name: 'Load more'}))

        expect(await screen.findByRole('cell', {name: '{"id":"order-2"}'})).toBeInTheDocument()
        expect(listFlatItems).toHaveBeenLastCalledWith('aws', 'nosql', 'orders', 'new-token', expect.any(AbortSignal))
    })
})

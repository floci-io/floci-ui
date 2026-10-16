import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {ReactElement} from 'react'
import {DynamoDbTableExplorer} from '@/components/DynamoDbTableExplorer'
import type {ChildItem, CloudResource, CollectionPage} from '@/types/resource'

const {listFlatItems, putFlatItem, queryFlatItems, queryFlatItemsByKey} = vi.hoisted(() => ({
    listFlatItems: vi.fn(),
    putFlatItem: vi.fn(),
    queryFlatItems: vi.fn(),
    queryFlatItemsByKey: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', () => ({listFlatItems, putFlatItem, queryFlatItems, queryFlatItemsByKey}))

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
        expect(screen.getByText('1 record')).toBeInTheDocument()
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

function indexedTable(): CloudResource {
    return {
        ...table('orders'),
        metadata: {
            keySchema: [{AttributeName: 'customerId', KeyType: 'HASH'}, {AttributeName: 'orderId', KeyType: 'RANGE'}],
            attributeDefinitions: [
                {AttributeName: 'customerId', AttributeType: 'S'},
                {AttributeName: 'orderId', AttributeType: 'S'},
                {AttributeName: 'status', AttributeType: 'S'},
                {AttributeName: 'total', AttributeType: 'N'},
            ],
            globalSecondaryIndexes: [{
                IndexName: 'by-status',
                KeySchema: [{AttributeName: 'status', KeyType: 'HASH'}, {AttributeName: 'total', KeyType: 'RANGE'}],
            }],
        },
    }
}

function order(body: Record<string, unknown>): ChildItem {
    const key = {customerId: body.customerId, orderId: body.orderId}
    return {id: JSON.stringify(key), collectionId: null, timestamp: null, body, metadata: {key}}
}

describe('DynamoDbTableExplorer query mode', () => {
    beforeEach(() => {
        listFlatItems.mockResolvedValue(page([order({customerId: 'c-1', orderId: 'o-1'})]))
    })

    async function openQueryMode() {
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={indexedTable()} runtimeReachable/>)
        await user.click(screen.getByRole('radio', {name: 'Query'}))
        return user
    }

    test('offers the table and every secondary index with their keys', async () => {
        await openQueryMode()

        const options = within(screen.getByRole('combobox', {name: 'Table or index'})).getAllByRole('option')
        expect(options.map((option) => option.textContent)).toEqual([
            'Table: orders (customerId, orderId)',
            'GSI: by-status (status, total)',
        ])
        expect(queryFlatItemsByKey).not.toHaveBeenCalled()
    })

    test('queries the table by partition key and shows the matches', async () => {
        queryFlatItemsByKey.mockResolvedValue(page([order({customerId: 'c-9', orderId: 'o-4'})]))
        const user = await openQueryMode()
        const run = screen.getByRole('button', {name: 'Run query'})

        expect(run).toBeDisabled()
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'c-9')
        await user.click(run)

        expect(await screen.findByRole('cell', {name: '{"customerId":"c-9","orderId":"o-4"}'})).toBeInTheDocument()
        expect(screen.queryByRole('cell', {name: '{"customerId":"c-1","orderId":"o-1"}'})).not.toBeInTheDocument()
        expect(queryFlatItemsByKey).toHaveBeenCalledWith('aws', 'nosql', 'orders', {partitionKey: 'c-9'}, undefined, expect.any(AbortSignal))
    })

    test('queries the table by partition key and a sort key condition', async () => {
        queryFlatItemsByKey.mockResolvedValue(page([order({customerId: 'c-1', orderId: 'o-2'})]))
        const user = await openQueryMode()

        const partitionKey = screen.getByRole('textbox', {name: 'Partition key'})
        expect(partitionKey).toHaveAttribute('placeholder', 'customerId (string)')
        await user.type(partitionKey, 'c-1')
        await user.selectOptions(screen.getByRole('combobox', {name: 'Sort key condition'}), 'beginsWith')
        const sortKey = screen.getByRole('textbox', {name: 'Sort key value'})
        expect(sortKey).toHaveAttribute('placeholder', 'orderId (string)')
        await user.type(sortKey, 'o-2{Enter}')

        expect(await screen.findByRole('cell', {name: '{"customerId":"c-1","orderId":"o-2"}'})).toBeInTheDocument()
        expect(queryFlatItemsByKey).toHaveBeenCalledWith('aws', 'nosql', 'orders', {
            partitionKey: 'c-1',
            sortKey: {operator: 'beginsWith', value: 'o-2'},
        }, undefined, expect.any(AbortSignal))
    })

    test('queries an index with a between condition in descending order', async () => {
        queryFlatItemsByKey.mockResolvedValue(page([]))
        const user = await openQueryMode()

        await user.selectOptions(screen.getByRole('combobox', {name: 'Table or index'}), 'by-status')
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'open')
        const condition = screen.getByRole('combobox', {name: 'Sort key condition'})
        expect(within(condition).queryByRole('option', {name: 'Begins with'})).not.toBeInTheDocument()
        await user.selectOptions(condition, 'between')
        await user.type(screen.getByRole('textbox', {name: 'Sort key lower bound'}), '10')
        expect(screen.getByRole('button', {name: 'Run query'})).toBeDisabled()
        await user.type(screen.getByRole('textbox', {name: 'Sort key upper bound'}), '50')
        await user.selectOptions(screen.getByRole('combobox', {name: 'Order'}), 'desc')
        await user.click(screen.getByRole('button', {name: 'Run query'}))

        expect(await screen.findByText('No items match this key condition.')).toBeInTheDocument()
        expect(queryFlatItemsByKey).toHaveBeenCalledWith('aws', 'nosql', 'orders', {
            index: 'by-status',
            partitionKey: 'open',
            sortKey: {operator: 'between', value: '10', to: '50'},
            descending: true,
        }, undefined, expect.any(AbortSignal))
    })

    test('continues the query that produced the cursor', async () => {
        queryFlatItemsByKey
            .mockResolvedValueOnce(page([order({customerId: 'c-1', orderId: 'o-1'})], 'key-2'))
            .mockResolvedValueOnce(page([order({customerId: 'c-1', orderId: 'o-2'})]))
        const user = await openQueryMode()

        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'c-1{Enter}')
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), '-edited')
        await user.click(await screen.findByRole('button', {name: 'Load more'}))

        expect(await screen.findByRole('cell', {name: '{"customerId":"c-1","orderId":"o-2"}'})).toBeInTheDocument()
        expect(queryFlatItemsByKey).toHaveBeenLastCalledWith('aws', 'nosql', 'orders', {partitionKey: 'c-1'}, 'key-2', expect.any(AbortSignal))
    })

    test('reruns an identical query instead of serving the cached result', async () => {
        queryFlatItemsByKey.mockResolvedValue(page([]))
        const user = await openQueryMode()
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'c-1')

        await user.click(screen.getByRole('button', {name: 'Run query'}))
        await screen.findByText('No items match this key condition.')
        await user.click(screen.getByRole('button', {name: 'Run query'}))

        await waitFor(() => expect(queryFlatItemsByKey).toHaveBeenCalledTimes(2))
    })

    test('shows the query error', async () => {
        queryFlatItemsByKey.mockRejectedValue(new Error('Key attribute total must be a number. (invalid_request)'))
        const user = await openQueryMode()

        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'c-1{Enter}')

        expect(await screen.findByText('Key attribute total must be a number. (invalid_request)')).toBeInTheDocument()
    })

    test('prompts for a partition key instead of counting zero records before the first query', async () => {
        await openQueryMode()

        expect(screen.getByText('Enter a partition key to query')).toBeInTheDocument()
        expect(screen.queryByText('0 records')).not.toBeInTheDocument()
    })

    test('does not rescan the hidden records while in query mode', async () => {
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={indexedTable()} runtimeReachable/>)
        await screen.findByRole('cell', {name: '{"customerId":"c-1","orderId":"o-1"}'})
        await user.click(screen.getByRole('radio', {name: 'Query'}))
        const scans = listFlatItems.mock.calls.length
        queryFlatItems.mockResolvedValue(page([]))

        const editor = screen.getByRole('textbox', {name: 'PartiQL statement'})
        await user.clear(editor)
        await user.type(editor, `DELETE FROM "orders" WHERE customerId = 'c-1' AND orderId = 'o-1'`)
        await user.click(screen.getByRole('button', {name: 'Run statement'}))
        await screen.findByText('0 rows')
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(listFlatItems.mock.calls.length).toBe(scans)
    })

    test('refreshes the query results after a PartiQL write', async () => {
        queryFlatItemsByKey.mockResolvedValue(page([order({customerId: 'c-1', orderId: 'o-1'})]))
        queryFlatItems.mockResolvedValue(page([]))
        const user = await openQueryMode()
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'c-1{Enter}')
        await screen.findByRole('cell', {name: '{"customerId":"c-1","orderId":"o-1"}'})
        queryFlatItemsByKey.mockResolvedValue(page([]))

        const editor = screen.getByRole('textbox', {name: 'PartiQL statement'})
        await user.clear(editor)
        await user.type(editor, `DELETE FROM "orders" WHERE customerId = 'c-1' AND orderId = 'o-1'`)
        await user.click(screen.getByRole('button', {name: 'Run statement'}))

        expect(await screen.findByText('No items match this key condition.')).toBeInTheDocument()
        expect(screen.queryByRole('cell', {name: '{"customerId":"c-1","orderId":"o-1"}'})).not.toBeInTheDocument()
    })

    test('labels rows from an index that does not project every attribute', async () => {
        const resource = indexedTable()
        resource.metadata.globalSecondaryIndexes = [{
            IndexName: 'by-status',
            KeySchema: [{AttributeName: 'status', KeyType: 'HASH'}, {AttributeName: 'total', KeyType: 'RANGE'}],
            Projection: {ProjectionType: 'KEYS_ONLY'},
        }]
        queryFlatItemsByKey.mockResolvedValue(page([order({customerId: 'c-1', orderId: 'o-1', status: 'open', total: 10})]))
        const user = userEvent.setup()
        renderExplorer(<DynamoDbTableExplorer cloud="aws" resource={resource} runtimeReachable/>)
        await user.click(screen.getByRole('radio', {name: 'Query'}))

        await user.selectOptions(screen.getByRole('combobox', {name: 'Table or index'}), 'by-status')
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'open{Enter}')
        await user.click(await screen.findByRole('button', {name: '{"customerId":"c-1","orderId":"o-1"}'}))

        expect(screen.getByText('Attributes projected into by-status')).toBeInTheDocument()
    })

    test('shows a record added in query mode among the scanned records', async () => {
        queryFlatItemsByKey.mockResolvedValue(page([]))
        putFlatItem.mockResolvedValue(order({customerId: 'c-5', orderId: 'o-1'}))
        const user = await openQueryMode()
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'c-1{Enter}')
        await screen.findByText('No items match this key condition.')

        await user.click(screen.getByRole('button', {name: 'Add record'}))
        listFlatItems.mockResolvedValue(page([order({customerId: 'c-1', orderId: 'o-1'}), order({customerId: 'c-5', orderId: 'o-1'})]))
        await user.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Add record'}))

        expect(await screen.findByRole('button', {name: '{"customerId":"c-5","orderId":"o-1"}', pressed: true})).toBeInTheDocument()
        expect(screen.getByRole('radio', {name: 'Scan'})).toBeChecked()
    })

    test('keeps the query inputs when switching to Scan and back', async () => {
        queryFlatItemsByKey.mockResolvedValue(page([]))
        const user = await openQueryMode()
        await user.selectOptions(screen.getByRole('combobox', {name: 'Table or index'}), 'by-status')
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'open')
        await user.selectOptions(screen.getByRole('combobox', {name: 'Sort key condition'}), 'gt')
        await user.type(screen.getByRole('textbox', {name: 'Sort key value'}), '20{Enter}')
        await screen.findByText('No items match this key condition.')

        await user.click(screen.getByRole('radio', {name: 'Scan'}))
        await user.click(screen.getByRole('radio', {name: 'Query'}))

        expect(screen.getByRole('combobox', {name: 'Table or index'})).toHaveValue('by-status')
        expect(screen.getByRole('textbox', {name: 'Partition key'})).toHaveValue('open')
        expect(screen.getByRole('combobox', {name: 'Sort key condition'})).toHaveValue('gt')
        expect(screen.getByRole('textbox', {name: 'Sort key value'})).toHaveValue('20')
    })

    test('returns to the scanned records', async () => {
        queryFlatItemsByKey.mockResolvedValue(page([]))
        const user = await openQueryMode()
        await user.type(screen.getByRole('textbox', {name: 'Partition key'}), 'c-1{Enter}')
        await screen.findByText('No items match this key condition.')

        await user.click(screen.getByRole('radio', {name: 'Scan'}))

        expect(await screen.findByRole('cell', {name: '{"customerId":"c-1","orderId":"o-1"}'})).toBeInTheDocument()
        expect(screen.queryByRole('form', {name: 'Query by key'})).not.toBeInTheDocument()
    })
})

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
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
})

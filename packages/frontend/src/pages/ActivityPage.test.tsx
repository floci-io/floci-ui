import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {ActivityEntry, ActivityFacets, ActivityPage} from '@/types/activity'
import {ActivityPage as ActivityPageView} from './ActivityPage'

const {listActivity, listClouds, listCloudServices} = vi.hoisted(() => ({
    listActivity: vi.fn(),
    listClouds: vi.fn(),
    listCloudServices: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/api/cloudProxyClient')>(),
    listActivity,
    listClouds,
    listCloudServices,
}))

const EMPTY_FACETS: ActivityFacets = {
    clouds: [], services: [], operations: [], statuses: [], resourceTypes: [],
}

let sequence = 0

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
    sequence += 1
    return {
        id: `activity-${sequence}`,
        timestamp: '2026-11-13T12:00:00.000Z',
        cloud: 'aws',
        service: 'storage',
        operation: 'Create',
        resourceType: 'bucket',
        resourceName: 'orders-bucket',
        status: 'success',
        source: 'Floci UI',
        httpMethod: 'POST',
        path: '/api/clouds/aws/services/storage/resources',
        statusCode: 201,
        detail: null,
        ...overrides,
    }
}

function feed(items: ActivityEntry[], nextCursor: string | null = null, facets: ActivityFacets = EMPTY_FACETS): ActivityPage {
    return {items, nextCursor, facets}
}

function renderActivity(path = '/activity') {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/activity" element={<ActivityPageView/>}/>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    listClouds.mockReset().mockResolvedValue([])
    listCloudServices.mockReset().mockResolvedValue([])
    listActivity.mockReset().mockResolvedValue(feed([]))
})

describe('Activity feed', () => {
    it('lists recorded operations with their operation, resource, status and source', async () => {
        listActivity.mockResolvedValue(feed([
            entry({id: 'a1', operation: 'Create', resourceName: 'orders-bucket'}),
            entry({
                id: 'a2', operation: 'Delete', resourceName: 'legacy-table', resourceType: null,
                status: 'failed', detail: 'Resource not found', source: 'AWS CLI',
            }),
        ], null, {
            ...EMPTY_FACETS,
            clouds: ['aws'],
            services: ['storage'],
            operations: ['Create', 'Delete'],
            statuses: ['failed', 'success'],
            resourceTypes: ['bucket'],
        }))

        renderActivity()

        const rows = await screen.findAllByRole('row')
        expect(rows[1]).toHaveTextContent('Create')
        expect(rows[1]).toHaveTextContent('orders-bucket')
        expect(rows[1]).toHaveTextContent('Success')
        expect(rows[1]).toHaveTextContent('Floci UI')
        expect(rows[2]).toHaveTextContent('Delete')
        expect(rows[2]).toHaveTextContent('Resource not found')
        expect(rows[2]).toHaveTextContent('Failed')
        expect(rows[2]).toHaveTextContent('AWS CLI')
    })

    it('shows an empty state rather than sample data when nothing has happened', async () => {
        renderActivity()

        expect(await screen.findByText('No activity yet')).toBeInTheDocument()
        expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('reads the resource search from the shared ?search= parameter', async () => {
        listActivity.mockResolvedValue(feed([entry({resourceName: 'orders-bucket'})]))

        renderActivity('/activity?search=orders')

        await screen.findByText('orders-bucket')
        expect(listActivity).toHaveBeenCalledWith(
            expect.objectContaining({search: 'orders'}),
            expect.anything(),
        )
    })

    it('filters by status and drops the load-more chain behind it', async () => {
        listActivity.mockResolvedValue(feed([entry({status: 'failed', detail: 'boom'})], 'cursor-1', {
            ...EMPTY_FACETS,
            operations: ['Start'],
            statuses: ['failed', 'success'],
            resourceTypes: ['bucket'],
        }))

        renderActivity()
        await screen.findByText('orders-bucket')

        fireEvent.change(screen.getByLabelText('Filter by status'), {target: {value: 'failed'}})

        await waitFor(() => expect(listActivity).toHaveBeenLastCalledWith(
            expect.objectContaining({status: 'failed', cursor: undefined}),
            expect.anything(),
        ))
        // The facet-driven operation select offers only what the feed holds.
        await waitFor(() => expect(screen.getByLabelText('Filter by operation')).toHaveTextContent('Start'))
    })

    it('appends the next page when Load more is pressed', async () => {
        listActivity
            .mockResolvedValueOnce(feed([entry({id: 'first', resourceName: 'first-bucket'})], 'cursor-1'))
            .mockResolvedValueOnce(feed([entry({id: 'second', resourceName: 'second-bucket'})], null))

        renderActivity()
        await screen.findByText('first-bucket')

        fireEvent.click(screen.getByRole('button', {name: 'Load more'}))

        expect(await screen.findByText('second-bucket')).toBeInTheDocument()
        expect(screen.getByText('first-bucket')).toBeInTheDocument()
        expect(listActivity).toHaveBeenLastCalledWith(
            expect.objectContaining({cursor: 'cursor-1'}),
            expect.anything(),
        )
    })
})

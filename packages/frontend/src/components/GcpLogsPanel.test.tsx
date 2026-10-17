import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {queryFlatItems} from '@/api/cloudProxyClient'
import {GcpLogsPanel} from './GcpLogsPanel'

vi.mock('@/api/cloudProxyClient', () => ({queryFlatItems: vi.fn()}))

const logName = 'projects/floci-local/logs/app'
const query = vi.mocked(queryFlatItems)

beforeEach(() => {
    query.mockReset()
    query.mockResolvedValue({items: [], nextCursor: null})
})

function renderPanel() {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={client}><GcpLogsPanel logName={logName} runtimeReachable/></QueryClientProvider>)
}

describe('GcpLogsPanel', () => {
    it('shows a real empty state when a log has no entries', async () => {
        renderPanel()
        expect(await screen.findByText('No log entries match these filters.')).toBeInTheDocument()
        expect(query).toHaveBeenCalledWith('gcp', 'logs', logName, '', undefined, expect.any(AbortSignal))
    })

    it('applies severity and time filters to the selected log', async () => {
        const user = userEvent.setup()
        renderPanel()
        await screen.findByText('No log entries match these filters.')

        await user.selectOptions(screen.getByLabelText('Minimum severity'), 'WARNING')
        fireEvent.change(screen.getByLabelText('Start time'), {target: {value: '2026-10-17T08:00'}})
        await user.click(screen.getByRole('button', {name: 'Apply filters'}))

        await waitFor(() => expect(query).toHaveBeenCalledWith(
            'gcp', 'logs', logName,
            `severity>=WARNING AND timestamp>="${new Date('2026-10-17T08:00').toISOString()}"`,
            undefined, expect.any(AbortSignal),
        ))
    })

    it('shows returned entries and follows a page token', async () => {
        const user = userEvent.setup()
        query.mockImplementation(async (_cloud, _service, _logName, _filter, cursor) => cursor === 'page-2'
            ? {items: [{id: '2', collectionId: null, timestamp: null, body: {message: 'second', severity: 'ERROR'}, metadata: {}}], nextCursor: null}
            : {items: [{id: '1', collectionId: null, timestamp: null, body: {message: 'first', severity: 'INFO'}, metadata: {}}], nextCursor: 'page-2'})
        renderPanel()

        expect(await screen.findByText('first')).toBeInTheDocument()
        await user.click(screen.getByRole('button', {name: 'Next page'}))
        expect(await screen.findByText('second')).toBeInTheDocument()
        expect(query).toHaveBeenCalledWith('gcp', 'logs', logName, '', 'page-2', expect.any(AbortSignal))
    })

    it('rejects an inverted time range before making a request', async () => {
        const user = userEvent.setup()
        renderPanel()
        await screen.findByText('No log entries match these filters.')
        fireEvent.change(screen.getByLabelText('Start time'), {target: {value: '2026-10-18T08:00'}})
        fireEvent.change(screen.getByLabelText('End time'), {target: {value: '2026-10-17T08:00'}})
        await user.click(screen.getByRole('button', {name: 'Apply filters'}))
        expect(screen.getByRole('alert')).toHaveTextContent('Start time must be before end time.')
        expect(query).toHaveBeenCalledTimes(1)
    })
})

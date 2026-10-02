import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {DEFAULT_ACCOUNT_ID, setAccountId} from '@/lib/accountStore'
import type {CloudProvider} from '@/types/cloud'
import {SettingsPage} from './SettingsPage'

vi.mock('@/api/queries/cloudQueries', () => ({
    useCloudsQuery: () => ({
        data: [
            {id: 'aws', displayName: 'AWS', availability: 'available'},
            {id: 'azure', displayName: 'Azure', availability: 'available'},
            {id: 'gcp', displayName: 'GCP', availability: 'available'},
            {id: 'oci', displayName: 'OCI', availability: 'available'},
        ],
    }),
}))

function SelectedDestination() {
    const {pathname} = useLocation()
    return <div>Selected {pathname}</div>
}

beforeEach(() => sessionStorage.clear())

function renderSettings(initialEntry: string | {pathname: string; state: {cloud: CloudProvider; fromCloudExplorer?: boolean}}) {
    setAccountId(DEFAULT_ACCOUNT_ID)
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})

    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[initialEntry]}>
                <Routes>
                    <Route path="/settings" element={<SettingsPage/>}/>
                    <Route path="/console/:cloud" element={<SelectedDestination/>}/>
                    <Route path="/cloud-explorer/:cloud/:service" element={<SelectedDestination/>}/>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

describe('SettingsPage', () => {
    it('sends a direct Settings cloud switch to Console Home', async () => {
        const user = userEvent.setup()
        renderSettings('/settings')

        expect(screen.getByRole('button', {name: 'Switch cloud, currently AWS'})).toBeInTheDocument()
        expect(screen.getByRole('button', {name: /Switch AWS account/})).toBeInTheDocument()

        await user.click(screen.getByRole('button', {name: 'Switch cloud, currently AWS'}))
        await user.click(screen.getByRole('option', {name: 'Azure'}))

        expect(screen.getByText('Selected /console/azure')).toBeInTheDocument()
    })

    it('sends a cloud switch from Cloud Explorer to the new cloud storage view', async () => {
        const user = userEvent.setup()
        renderSettings({pathname: '/settings', state: {cloud: 'aws', fromCloudExplorer: true}})

        await user.click(screen.getByRole('button', {name: 'Switch cloud, currently AWS'}))
        await user.click(screen.getByRole('option', {name: 'Azure'}))

        expect(screen.getByText('Selected /cloud-explorer/azure/storage')).toBeInTheDocument()
    })

    it('keeps OCI selected in Settings and can switch back to AWS', async () => {
        const user = userEvent.setup()
        renderSettings({pathname: '/settings', state: {cloud: 'oci'}})

        await user.click(screen.getByRole('button', {name: 'Switch cloud, currently OCI'}))
        expect(screen.getByRole('option', {name: 'OCI'})).toHaveAttribute('aria-selected', 'true')
        await user.click(screen.getByRole('option', {name: 'AWS'}))

        expect(screen.getByText('Selected /console/aws')).toBeInTheDocument()
    })

    it('recalls Azure on direct global Settings entry', async () => {
        const user = userEvent.setup()
        sessionStorage.setItem('floci-last-cloud', 'azure')
        renderSettings('/settings')

        await user.click(screen.getByRole('button', {name: 'Switch cloud, currently Azure'}))
        expect(screen.getByRole('option', {name: 'Azure'})).toHaveAttribute('aria-selected', 'true')
        await user.click(screen.getByRole('option', {name: 'AWS'}))

        expect(screen.getByText('Selected /console/aws')).toBeInTheDocument()
    })
})

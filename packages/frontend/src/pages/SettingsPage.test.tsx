import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {DEFAULT_ACCOUNT_ID, getAccountId, setAccountId} from '@/lib/accountStore'
import {getRegion, setRegion} from '@/lib/regionStore'
import type {CloudDescriptor, CloudProvider} from '@/types/cloud'
import {SettingsPage} from './SettingsPage'

const ALL_CLOUDS: CloudDescriptor[] = [
    {id: 'aws', displayName: 'AWS', availability: 'available'},
    {id: 'azure', displayName: 'Azure', availability: 'available'},
    {id: 'gcp', displayName: 'GCP', availability: 'available'},
    {id: 'oci', displayName: 'OCI', availability: 'available'},
]

const clouds = vi.hoisted(() => ({data: [] as CloudDescriptor[]}))

vi.mock('@/api/queries/cloudQueries', () => ({
    useCloudsQuery: () => clouds,
    useCloudStatusQuery: () => ({data: {region: 'eu-central-1'}}),
}))

function SelectedDestination() {
    const {pathname} = useLocation()
    return <div>Selected {pathname}</div>
}

beforeEach(() => {
    sessionStorage.clear()
    clouds.data = ALL_CLOUDS
})

function renderSettings(
    initialEntry: string | {pathname: string; state: {cloud: CloudProvider; fromCloudExplorer?: boolean}},
    accountId = DEFAULT_ACCOUNT_ID,
) {
    setAccountId(accountId)
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

    it('shows the AWS region switcher with the console default, and switches region', async () => {
        const user = userEvent.setup()
        setRegion(null)
        renderSettings('/settings')

        await user.click(screen.getByRole('button', {name: 'Switch AWS region eu-central-1'}))
        expect(screen.getByRole('option', {name: /Console default.*eu-central-1/})).toHaveAttribute('aria-selected', 'true')

        // A defined list, with the AWS console's names, and no field to type a region into.
        expect(screen.getByRole('option', {name: /eu-central-1.*Europe \(Frankfurt\)/})).toBeInTheDocument()
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

        await user.click(screen.getByRole('option', {name: /us-west-2.*US West \(Oregon\)/}))

        expect(getRegion()).toBe('us-west-2')
        expect(screen.getByRole('button', {name: 'Switch AWS region us-west-2'})).toBeInTheDocument()

        // The region just picked comes back on top, under Recent, and is not offered a second time below.
        await user.click(screen.getByRole('button', {name: 'Switch AWS region us-west-2'}))
        expect(within(screen.getByRole('group', {name: 'Recent regions'})).getByRole('option', {name: /us-west-2/}))
            .toHaveAttribute('aria-selected', 'true')
        expect(within(screen.getByRole('group', {name: 'Other regions'})).getAllByRole('option')).toHaveLength(35)
        expect(screen.getAllByRole('option', {name: /us-west-2/})).toHaveLength(1)
        setRegion(null)
    })

    it.each(['azure', 'gcp', 'oci'] as const)('shows no account or region setting on %s', (cloud) => {
        setRegion('us-west-2')
        renderSettings({pathname: '/settings', state: {cloud}}, '111122223333')

        expect(screen.getByRole('button', {name: /Switch cloud, currently/})).toBeInTheDocument()
        expect(screen.queryByRole('button', {name: /Switch AWS account/})).not.toBeInTheDocument()
        expect(screen.queryByRole('button', {name: /Switch AWS region/})).not.toBeInTheDocument()
        expect(screen.queryByText('Account', {selector: '.settings-label'})).not.toBeInTheDocument()
        expect(screen.queryByText('Region', {selector: '.settings-label'})).not.toBeInTheDocument()
        // The stored choices are kept for the return to AWS.
        expect(getAccountId()).toBe('111122223333')
        expect(getRegion()).toBe('us-west-2')
        setRegion(null)
    })

    it('shows the account and region settings on AWS, with the stored choices', () => {
        setRegion('us-west-2')
        renderSettings({pathname: '/settings', state: {cloud: 'aws'}}, '111122223333')

        expect(screen.getByText('Account', {selector: '.settings-label'})).toBeInTheDocument()
        expect(screen.getByRole('button', {name: 'Switch AWS account 1111-2222-3333'})).toBeInTheDocument()
        expect(screen.getByText('Region', {selector: '.settings-label'})).toBeInTheDocument()
        expect(screen.getByRole('button', {name: 'Switch AWS region us-west-2'})).toBeInTheDocument()
        setRegion(null)
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

    it('offers only the scoped cloud when an emulator started the console', async () => {
        const user = userEvent.setup()
        clouds.data = [{id: 'azure', displayName: 'Azure', availability: 'available', default: true}]
        sessionStorage.setItem('floci-last-cloud', 'oci')
        renderSettings('/settings')

        await user.click(screen.getByRole('button', {name: 'Switch cloud, currently Azure'}))

        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Azure'])
    })
})

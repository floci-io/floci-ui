import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {Layout} from '@/components/Layout'
import type {CloudServiceDescriptor, CloudStatus} from '@/types/cloud'
import {CloudConsoleHomePage} from './CloudConsoleHomePage'

const {listClouds, listCloudServices, getCloudStatus, listCloudResourceCounts} = vi.hoisted(() => ({
    listClouds: vi.fn(),
    listCloudServices: vi.fn(),
    getCloudStatus: vi.fn(),
    listCloudResourceCounts: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/api/cloudProxyClient')>(),
    listClouds,
    listCloudServices,
    getCloudStatus,
    listCloudResourceCounts,
}))

vi.mock('@/lib/useSidebar', () => ({
    useSidebar: () => ({collapsed: false, toggle: vi.fn(), toggleRef: {current: null}}),
}))

const services: CloudServiceDescriptor[] = [
    {
        cloud: 'aws', service: 'k8s', displayName: 'EKS',
        description: 'Managed Kubernetes clusters for containerized workloads.',
        availability: 'available', route: 'k8s',
        iconKey: 'k8s', group: 'Compute', order: 1,
    },
    {
        cloud: 'aws', service: 'storage', displayName: 'S3',
        description: 'Object storage.',
        availability: 'available', route: 'storage',
        iconKey: 'storage', group: 'Storage', order: 2,
    },
    {
        cloud: 'aws', service: 'messaging', displayName: 'SQS',
        description: 'Queue messages.',
        availability: 'coming_soon', reason: 'Not configured', route: 'messaging',
        iconKey: 'messaging', group: 'Integration', order: 3,
    },
]

const reachableStatus: CloudStatus = {
    cloud: 'aws', adapterRegistered: true, runtime: 'reachable',
    endpoint: 'http://localhost:4566', checkedAt: '2026-09-29T00:00:00.000Z', error: null,
}

const unavailableStatus: CloudStatus = {
    cloud: 'aws', adapterRegistered: true, runtime: 'unavailable',
    endpoint: null, checkedAt: '2026-09-29T00:00:00.000Z', error: null,
}



function renderConsole(search: string) {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/console/aws${search ? `?search=${search}` : ''}`]}>
                <Routes>
                    <Route element={<Layout/>}>
                        <Route path="/console/:cloud" element={<CloudConsoleHomePage/>}/>
                    </Route>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    listClouds.mockReset().mockResolvedValue([])
    listCloudServices.mockReset().mockResolvedValue(services)
    getCloudStatus.mockReset().mockResolvedValue(reachableStatus)
    listCloudResourceCounts.mockReset().mockResolvedValue([
        {cloud: 'aws', service: 'k8s', count: 2},
        {cloud: 'aws', service: 'storage', count: 0},
    ])
})

describe('Console Home', () => {
    it('shows only services with at least one resource instance', async () => {
        renderConsole('')

        const eksHeading = await screen.findByRole('heading', {name: 'EKS'})
        expect(eksHeading).toBeInTheDocument()
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'S3'})).not.toBeInTheDocument())
        expect(screen.queryByRole('heading', {name: 'SQS'})).not.toBeInTheDocument()
        expect(eksHeading.closest('.service-card')).toHaveTextContent('2')
    })

    it('finds a visible service by description while filtering out services without instances', async () => {
        renderConsole('kubernetes')

        expect(await screen.findByRole('heading', {name: 'EKS'})).toBeInTheDocument()
        expect(screen.getByText('Managed Kubernetes clusters for containerized workloads.')).toBeInTheDocument()
        await waitFor(() => expect(screen.getByRole('navigation', {name: 'Console'})).toHaveTextContent('EKS'))
        expect(screen.getByRole('navigation', {name: 'Console'})).not.toHaveTextContent('S3')
    })

    it('shows an empty result without crashing on a missing description', async () => {
        renderConsole('not-found')

        expect(await screen.findByText('No services matching "not-found"')).toBeInTheDocument()
        await screen.findByText('No matching services')
        expect(screen.getByRole('navigation', {name: 'Console'})).toHaveTextContent('No matching services')
    })

    it('shows an honest empty state when no service has resources', async () => {
        listCloudResourceCounts.mockReset().mockResolvedValue([
            {cloud: 'aws', service: 'k8s', count: 0},
            {cloud: 'aws', service: 'storage', count: 0},
        ])
        renderConsole('')

        expect(await screen.findByText('No resources yet. Create a resource to see it here.')).toBeInTheDocument()
    })

    it('does not show a false empty state when runtime is unavailable', async () => {
        getCloudStatus.mockReset().mockResolvedValue(unavailableStatus)
        renderConsole('')

        expect(await screen.findByText('Runtime unavailable.')).toBeInTheDocument()
        expect(screen.queryByText('No resources yet. Create a resource to see it here.')).not.toBeInTheDocument()
    })
})
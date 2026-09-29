import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {Layout} from '@/components/Layout'
import type {CloudServiceDescriptor, CloudStatus} from '@/types/cloud'
import {CloudConsoleHomePage} from './CloudConsoleHomePage'

const {listClouds, listCloudServices, getCloudStatus} = vi.hoisted(() => ({
    listClouds: vi.fn(),
    listCloudServices: vi.fn(),
    getCloudStatus: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/api/cloudProxyClient')>(),
    listClouds,
    listCloudServices,
    getCloudStatus,
}))

vi.mock('@/lib/useSidebar', () => ({
    useSidebar: () => ({collapsed: false, toggle: vi.fn(), toggleRef: {current: null}}),
}))

const services: CloudServiceDescriptor[] = [
    {
        cloud: 'aws', service: 'k8s', displayName: 'EKS',
        description: 'Managed Kubernetes clusters for containerized workloads.',
        availability: 'coming_soon', reason: 'Not configured', route: 'k8s',
        iconKey: 'k8s', group: 'Compute', order: 1,
    },
    {
        cloud: 'aws', service: 'storage', displayName: 'S3',
        availability: 'coming_soon', reason: 'Not configured', route: 'storage',
        iconKey: 'storage', group: 'Storage', order: 2,
    } as CloudServiceDescriptor,
]

const status: CloudStatus = {
    cloud: 'aws', adapterRegistered: true, runtime: 'unavailable',
    endpoint: null, checkedAt: '2026-09-29T00:00:00.000Z', error: null,
}

function renderConsole(search: string) {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/console/aws?search=${search}`]}>
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
    getCloudStatus.mockReset().mockResolvedValue(status)
})

describe('Console service search', () => {
    it('finds a description-only match while an older API omits another description', async () => {
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
})

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {CloudServiceDescriptor} from '@/types/cloud'
import {CloudExplorerPage} from './CloudExplorerPage'

const {listCloudServices} = vi.hoisted(() => ({
    listCloudServices: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/api/cloudProxyClient')>(),
    listCloudServices,
}))

vi.mock('@/lib/useSidebar', () => ({
    useSidebar: () => ({collapsed: false, toggle: vi.fn(), toggleRef: {current: null}}),
}))

const servicesWithDocs: CloudServiceDescriptor[] = [
    {
        cloud: 'aws',
        service: 'k8s',
        displayName: 'EKS',
        description: 'Managed Kubernetes clusters for containerized workloads.',
        availability: 'available',
        route: 'k8s',
        iconKey: 'k8s',
        group: 'Compute',
        order: 1,
        docsUrl: 'https://floci.io/floci/services/eks/',
    },
    {
        cloud: 'aws',
        service: 'loadbalancing',
        displayName: 'ELB',
        description: 'Load balancing for AWS.',
        availability: 'available',
        route: 'loadbalancing',
        iconKey: 'loadbalancing',
        group: 'Compute',
        order: 2,
        // No docsUrl defined
    },
]

function renderExplorer(serviceSlug: string) {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[`/cloud-explorer/aws/${serviceSlug}`]}>
                <Routes>
                    <Route path="/cloud-explorer/:cloud/:service" element={<CloudExplorerPage/>}/>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    listCloudServices.mockReset().mockResolvedValue(servicesWithDocs)
})

describe('CloudExplorerPage documentation links', () => {
    it('renders the external docs link when docsUrl is present', async () => {
        renderExplorer('k8s')

        const docsLink = await screen.findByRole('link', {name: /docs/i})
        expect(docsLink).toBeInTheDocument()
        expect(docsLink).toHaveAttribute('href', 'https://floci.io/floci/services/eks/')
        expect(docsLink).toHaveAttribute('target', '_blank')
        expect(docsLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('omits the docs link when docsUrl is absent', async () => {
        renderExplorer('loadbalancing')

        // Wait for the service description text to load instead of the heading
        await screen.findByText('Load balancing for AWS.')
        expect(screen.queryByRole('link', {name: /docs/i})).not.toBeInTheDocument()
    })
})

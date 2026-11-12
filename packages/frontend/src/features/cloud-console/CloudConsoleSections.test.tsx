import {render, screen} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import {Cube} from '@/components/sodium/icon'
import {ServiceGrid} from './CloudConsoleSections'

describe('ServiceGrid', () => {
    it('shows the service introduction alongside its name and availability', () => {
        render(
            <ServiceGrid
                services={[{
                    id: 'k8s',
                    label: 'EKS',
                    description: 'Managed Kubernetes clusters for containerized workloads.',
                    status: 'available',
                    count: 2,
                    icon: Cube,
                    route: '/cloud-explorer/aws/k8s',
                    meta: 'resources',
                }]}
                runtimeReachable
                onNavigate={vi.fn()}
            />,
        )

        expect(screen.getByRole('link', {name: 'EKS'})).toHaveAttribute('href', '/cloud-explorer/aws/k8s')
        expect(screen.getByText('Managed Kubernetes clusters for containerized workloads.')).toBeInTheDocument()
        expect(screen.getByText(/available/)).toBeInTheDocument()
    })
})

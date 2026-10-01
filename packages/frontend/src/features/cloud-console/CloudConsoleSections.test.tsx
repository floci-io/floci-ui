import {render, screen} from '@testing-library/react'
import {Cloud} from 'lucide-react'
import {describe, expect, it, vi} from 'vitest'
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
                    icon: Cloud,
                    route: '/cloud-explorer/aws/k8s',
                    meta: 'resources',
                }]}
                runtimeReachable
                onNavigate={vi.fn()}
            />,
        )

        const card = screen.getByRole('button', {name: /EKS/})
        expect(card).toHaveTextContent('Managed Kubernetes clusters for containerized workloads.')
        expect(card).toHaveTextContent('available')
    })
})

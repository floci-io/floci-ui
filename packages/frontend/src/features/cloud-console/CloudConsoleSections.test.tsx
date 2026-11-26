import {fireEvent, render, screen} from '@testing-library/react'
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

    it('shows an empty state when no resources exist', () => {
        render(
            <ServiceGrid
                services={[]}
                runtimeReachable
                onNavigate={vi.fn()}
            />,
        )

        expect(screen.getByText('No resources yet. Create a resource to see it here.')).toBeInTheDocument()
    })

    it('shows a loading state while resources are loading', () => {
        render(
            <ServiceGrid
                services={[]}
                runtimeReachable
                resourcesLoading
                onNavigate={vi.fn()}
            />,
        )

        expect(screen.getByText('Loading resources...')).toBeInTheDocument()
    })

    it('shows a warning when some service counts fail to load', () => {
        render(
            <ServiceGrid
                services={[{
                    id: 'k8s',
                    label: 'EKS',
                    description: 'Managed Kubernetes clusters.',
                    status: 'available',
                    count: 1,
                    icon: Cloud,
                    route: '/cloud-explorer/aws/k8s',
                    meta: 'resources',
                }]}
                runtimeReachable
                resourceCountErrorCount={2}
                onNavigate={vi.fn()}
            />,
        )

        expect(screen.getByText(/Could not load 2 services\./)).toBeInTheDocument()
    })

    it('shows count unavailable card and retries counts', () => {
        const onRetryCounts = vi.fn()
        render(
            <ServiceGrid
                services={[{
                    id: 'k8s',
                    label: 'EKS',
                    description: 'Managed Kubernetes clusters.',
                    status: 'available',
                    countError: true,
                    countErrorMessage: 'boom',
                    icon: Cloud,
                    route: '/cloud-explorer/aws/k8s',
                    meta: 'count unavailable',
                }]}
                runtimeReachable
                resourceCountErrorCount={1}
                resourceCountFailedServices={['EKS']}
                onRetryCounts={onRetryCounts}
                onNavigate={vi.fn()}
            />,
        )

        expect(screen.getAllByText('count unavailable').length).toBeGreaterThan(0)
        expect(screen.getByText('boom')).toBeInTheDocument()
        expect(screen.getByText(/Could not load 1 service \(EKS\)\./)).toBeInTheDocument()
        expect(screen.getAllByRole('button', {name: 'Retry'}).length).toBeGreaterThan(0)
        fireEvent.click(screen.getAllByRole('button', {name: 'Retry'})[0])
        expect(onRetryCounts).toHaveBeenCalled()
    })
})

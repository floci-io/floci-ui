import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {renderHook, waitFor} from '@testing-library/react'
import type {ReactNode} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getCloudStatus, listCloudResources, listCloudServices} from '@/api/cloudProxyClient'
import {setRegion} from '@/lib/regionStore'
import type {CloudServiceDescriptor, CloudStatus} from '@/types/cloud'
import type {CloudResource} from '@/types/resource'
import {useCloudConsoleHomeData} from './useCloudConsoleHomeData'

vi.mock('@/api/cloudProxyClient', () => ({
    getCloudStatus: vi.fn(),
    listCloudResources: vi.fn(),
    listCloudServices: vi.fn(),
}))

const serverless: CloudServiceDescriptor = {
    cloud: 'aws',
    service: 'serverless',
    displayName: 'Lambda',
    description: 'Functions',
    availability: 'available',
    route: 'serverless',
    iconKey: 'serverless',
    group: 'Compute',
    order: 1,
}

const status: CloudStatus = {
    cloud: 'aws',
    adapterRegistered: true,
    runtime: 'reachable',
    endpoint: 'http://localhost:4566',
    checkedAt: '2026-11-26T00:00:00Z',
    error: null,
}

function lambda(id: string, region: string): CloudResource {
    return {id, name: id, cloud: 'aws', service: 'serverless', type: 'lambda', region, createdAt: null, metadata: {}}
}

describe('useCloudConsoleHomeData', () => {
    let queryClient: QueryClient

    beforeEach(() => {
        vi.clearAllMocks()
        setRegion('us-east-1')
        queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        vi.mocked(listCloudServices).mockResolvedValue([serverless])
        vi.mocked(getCloudStatus).mockResolvedValue(status)
    })

    afterEach(() => {
        queryClient.clear()
        setRegion(null)
    })

    function wrapper({children}: {children: ReactNode}) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    it('does not show the previous region counts after a region switch', async () => {
        vi.mocked(listCloudResources).mockResolvedValue([
            lambda('fn-a', 'us-east-1'),
            lambda('fn-b', 'us-east-1'),
            lambda('fn-c', 'us-east-1'),
        ])
        const first = renderHook(() => useCloudConsoleHomeData('aws'), {wrapper})
        await waitFor(() => expect(first.result.current.resourceCount).toBe(3))
        first.unmount()

        let resolveEu: (rows: CloudResource[]) => void = () => {}
        vi.mocked(listCloudResources).mockImplementation(
            () => new Promise<CloudResource[]>((resolve) => { resolveEu = resolve }),
        )
        setRegion('eu-central-1')

        const second = renderHook(() => useCloudConsoleHomeData('aws'), {wrapper})
        await waitFor(() => expect(listCloudResources).toHaveBeenCalledTimes(2))
        expect(second.result.current.resourceCount).toBe(0)
        expect(second.result.current.serviceCards[0]?.count).toBeUndefined()

        resolveEu([lambda('fn-eu', 'eu-central-1')])
        await waitFor(() => expect(second.result.current.resourceCount).toBe(1))
        expect(second.result.current.serviceCards[0]?.count).toBe(1)
    })

    it('keeps each region cached, so switching back shows its counts at once', async () => {
        vi.mocked(listCloudResources).mockResolvedValue([lambda('fn-a', 'us-east-1')])
        const first = renderHook(() => useCloudConsoleHomeData('aws'), {wrapper})
        await waitFor(() => expect(first.result.current.resourceCount).toBe(1))
        first.unmount()

        vi.mocked(listCloudResources).mockResolvedValue([])
        setRegion('eu-central-1')
        const second = renderHook(() => useCloudConsoleHomeData('aws'), {wrapper})
        await waitFor(() => expect(listCloudResources).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(second.result.current.serviceCards[0]?.count).toBe(0))
        second.unmount()

        setRegion('us-east-1')
        const third = renderHook(() => useCloudConsoleHomeData('aws'), {wrapper})
        expect(third.result.current.resourceCount).toBe(1)
    })
})

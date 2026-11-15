import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import {deleteEc2Vpc, listEc2Vpcs} from '@/api/aws/ec2.api'
import {DEFAULT_ACCOUNT_ID, getAccountId, setAccountId} from '@/lib/accountStore'
import {NetworkingPanel} from './NetworkingPanel'

vi.mock('@/api/aws/ec2.api', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/api/aws/ec2.api')>()
    return {
        ...original,
        deleteEc2Vpc: vi.fn(),
        listEc2SecurityGroups: vi.fn().mockResolvedValue([]),
        listEc2KeyPairs: vi.fn().mockResolvedValue([]),
        listEc2Vpcs: vi.fn().mockResolvedValue([{
            vpcId: 'vpc-1', cidrBlock: '10.0.0.0/16', isDefault: false, tags: [],
        }]),
        listEc2Subnets: vi.fn().mockResolvedValue([]),
        listEc2InternetGateways: vi.fn().mockResolvedValue([]),
        listEc2RouteTables: vi.fn().mockResolvedValue([]),
        listEc2ElasticIps: vi.fn().mockResolvedValue([]),
        listEc2Instances: vi.fn().mockResolvedValue([]),
        getEc2VpcAttributes: vi.fn().mockResolvedValue({enableDnsHostnames: true, enableDnsSupport: true}),
    }
})

describe('NetworkingPanel VPC deletion', () => {
    it('shows the load balancer preflight error after a failed delete', async () => {
        vi.mocked(deleteEc2Vpc).mockReset().mockRejectedValue(new Error('Delete load balancer web before deleting VPC vpc-1'))
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        render(
            <QueryClientProvider client={client}>
                <NetworkingPanel
                    cloud="aws"
                    runtimeReachable
                    resource={{cloud: 'aws', service: 'networking', type: 'vpc', id: 'vpc-1', name: 'vpc-1', region: 'us-east-1', createdAt: null, metadata: {}}}
                />
            </QueryClientProvider>,
        )

        fireEvent.click(await screen.findByRole('button', {name: 'Delete'}))
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Delete'}))

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Delete load balancer web before deleting VPC vpc-1'))
        expect(deleteEc2Vpc).toHaveBeenCalledExactlyOnceWith('vpc-1')
    })
})

describe('NetworkingPanel account switch', () => {
    it('does not show the previous account\'s VPCs while the new account loads', async () => {
        const vpcA = {vpcId: 'vpc-a', cidrBlock: '10.40.0.0/16', isDefault: false, tags: []}
        vi.mocked(listEc2Vpcs).mockImplementation(() =>
            getAccountId() === DEFAULT_ACCOUNT_ID ? Promise.resolve([vpcA]) : new Promise(() => {}),
        )
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        render(
            <QueryClientProvider client={client}>
                <NetworkingPanel cloud="aws" runtimeReachable/>
            </QueryClientProvider>,
        )
        expect(await screen.findByText('10.40.0.0/16')).toBeInTheDocument()

        try {
            // What the account switcher does: switch, then refetch everything.
            act(() => {
                setAccountId('111111111111')
                void client.invalidateQueries()
            })

            expect(screen.queryByText('10.40.0.0/16')).not.toBeInTheDocument()
        } finally {
            setAccountId(DEFAULT_ACCOUNT_ID)
        }
    })
})

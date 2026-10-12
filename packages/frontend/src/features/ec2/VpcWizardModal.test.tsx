import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createVpcWizard} from '@/api/aws/ec2.api'
import {NetworkingPanel} from '@/components/NetworkingPanel'
import {VpcWizardModal} from './VpcWizardModal'

vi.mock('@/api/aws/ec2.api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/aws/ec2.api')>()
  return {
    ...original,
    createVpcWizard: vi.fn(),
    listEc2SecurityGroups: vi.fn().mockResolvedValue([]),
    listEc2KeyPairs: vi.fn().mockResolvedValue([]),
    listEc2Vpcs: vi.fn().mockResolvedValue([]),
    listEc2Subnets: vi.fn().mockResolvedValue([]),
    listEc2InternetGateways: vi.fn().mockResolvedValue([]),
    listEc2RouteTables: vi.fn().mockResolvedValue([]),
    listEc2ElasticIps: vi.fn().mockResolvedValue([]),
    listEc2Instances: vi.fn().mockResolvedValue([]),
  }
})

beforeEach(() => {
  vi.mocked(createVpcWizard).mockReset().mockResolvedValue({
    vpcId: 'vpc-test', igwId: 'igw-test', publicRouteTableId: 'rtb-test',
    publicSubnetIds: [], privateSubnetIds: [], subnetGroups: [],
  })
})

describe.each(['EC2 wizard', 'networking panel'] as const)('%s subnet boundaries', (entrance) => {
  function openWizard() {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={client}>
        {entrance === 'EC2 wizard'
          ? <VpcWizardModal onClose={() => {}} />
          : <NetworkingPanel cloud="aws" runtimeReachable />}
      </QueryClientProvider>,
    )
    if (entrance === 'networking panel') fireEvent.click(screen.getByRole('button', {name: /wizard/i}))
    fireEvent.change(screen.getByPlaceholderText('my-vpc'), {target: {value: 'small-vpc'}})
  }

  it('blocks overflowing /28 subnets and permits submission after correcting the VPC', async () => {
    openWizard()
    const cidr = screen.getByPlaceholderText('10.0.0.0/16')
    fireEvent.change(cidr, {target: {value: '10.0.0.0/28'}})

    expect(screen.getByText('Requested subnet layout is invalid or does not fit the VPC CIDR.')).toBeInTheDocument()
    const submit = screen.getByRole('button', {name: 'Create VPC'})
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(createVpcWizard).not.toHaveBeenCalled()

    fireEvent.change(cidr, {target: {value: '10.0.0.0/16'}})
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(createVpcWizard).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createVpcWizard).mock.calls[0][0]).toMatchObject({
      name: 'small-vpc', cidrBlock: '10.0.0.0/16', natGateway: false,
      subnetGroups: [
        {name: 'public', count: 2, isPublic: true},
        {name: 'private', count: 2, isPublic: false},
      ],
    })
  })

  it('blocks a VPC with nonzero host bits before calling the API', () => {
    openWizard()
    fireEvent.change(screen.getByPlaceholderText('10.0.0.0/16'), {target: {value: '10.0.0.16/24'}})

    const submit = screen.getByRole('button', {name: 'Create VPC'})
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(createVpcWizard).not.toHaveBeenCalled()
  })
})

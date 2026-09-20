import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, test, vi} from 'vitest'
import {AppConfigPanel} from './AppConfigPanel'
import {DEFAULT_ACCOUNT_ID, getAccountId, setAccountId} from '@/lib/accountStore'
import type {CloudResource} from '@/types/resource'

const cloudProxyMocks = vi.hoisted(() => ({
    listAppConfigEnvironments: vi.fn(),
    listAppConfigConfigurationProfiles: vi.fn(),
    listAppConfigDeploymentStrategies: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', () => ({
    createAppConfigConfigurationProfile: vi.fn(),
    createAppConfigDeploymentStrategy: vi.fn(),
    createAppConfigEnvironment: vi.fn(),
    createAppConfigHostedConfigurationVersion: vi.fn(),
    deleteAppConfigConfigurationProfile: vi.fn(),
    deleteAppConfigDeploymentStrategy: vi.fn(),
    deleteAppConfigEnvironment: vi.fn(),
    deleteAppConfigHostedConfigurationVersion: vi.fn(),
    getAppConfigDeployment: vi.fn(),
    getAppConfigHostedConfigurationVersion: vi.fn(),
    listAppConfigConfigurationProfiles: cloudProxyMocks.listAppConfigConfigurationProfiles,
    listAppConfigDeploymentStrategies: cloudProxyMocks.listAppConfigDeploymentStrategies,
    listAppConfigEnvironments: cloudProxyMocks.listAppConfigEnvironments,
    listAppConfigHostedConfigurationVersions: vi.fn(),
    startAppConfigDeployment: vi.fn(),
}))

const application: CloudResource = {
    id: 'app-1',
    name: 'orders',
    cloud: 'aws',
    service: 'configuration',
    type: 'appconfig-application',
    region: 'us-east-1',
    createdAt: null,
    metadata: {},
}

describe('AppConfigPanel account isolation', () => {
    beforeEach(() => {
        setAccountId(DEFAULT_ACCOUNT_ID)
        cloudProxyMocks.listAppConfigEnvironments.mockReset()
        cloudProxyMocks.listAppConfigConfigurationProfiles.mockReset()
        cloudProxyMocks.listAppConfigDeploymentStrategies.mockReset()
        cloudProxyMocks.listAppConfigConfigurationProfiles.mockResolvedValue([])
        cloudProxyMocks.listAppConfigDeploymentStrategies.mockResolvedValue([])
        cloudProxyMocks.listAppConfigEnvironments.mockImplementation(async () => [{
            id: `environment-${getAccountId()}`,
            applicationId: application.id,
            name: `environment-${getAccountId()}`,
            description: null,
            state: 'READY_FOR_DEPLOYMENT',
        }])
    })

    test('loads a fresh cache and resets account-scoped form state after an account switch', async () => {
        const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        const user = userEvent.setup()

        render(
            <QueryClientProvider client={queryClient}>
                <AppConfigPanel cloud="aws" resource={application} runtimeReachable/>
            </QueryClientProvider>,
        )

        expect(await screen.findAllByText(`environment-${DEFAULT_ACCOUNT_ID}`)).toHaveLength(2)
        const environmentName = screen.getByPlaceholderText('Environment name')
        await user.type(environmentName, 'private-draft')
        expect(environmentName).toHaveValue('private-draft')

        await act(async () => {
            setAccountId('111111111111')
        })

        expect(await screen.findAllByText('environment-111111111111')).toHaveLength(2)
        expect(screen.queryAllByText(`environment-${DEFAULT_ACCOUNT_ID}`)).toHaveLength(0)
        expect(screen.getByPlaceholderText('Environment name')).toHaveValue('')

        await waitFor(() => {
            expect(cloudProxyMocks.listAppConfigEnvironments).toHaveBeenCalledTimes(2)
        })
        expect(queryClient.getQueryData(['appconfig-environments', DEFAULT_ACCOUNT_ID, 'aws', application.id])).toBeDefined()
        expect(queryClient.getQueryData(['appconfig-environments', '111111111111', 'aws', application.id])).toBeDefined()
    })
})

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
    listAppConfigHostedConfigurationVersions: vi.fn(),
    getAppConfigHostedConfigurationVersion: vi.fn(),
    createAppConfigHostedConfigurationVersion: vi.fn(),
}))

vi.mock('@/api/cloudProxyClient', () => ({
    createAppConfigConfigurationProfile: vi.fn(),
    createAppConfigDeploymentStrategy: vi.fn(),
    createAppConfigEnvironment: vi.fn(),
    createAppConfigHostedConfigurationVersion: cloudProxyMocks.createAppConfigHostedConfigurationVersion,
    deleteAppConfigConfigurationProfile: vi.fn(),
    deleteAppConfigDeploymentStrategy: vi.fn(),
    deleteAppConfigEnvironment: vi.fn(),
    deleteAppConfigHostedConfigurationVersion: vi.fn(),
    getAppConfigDeployment: vi.fn(),
    getAppConfigHostedConfigurationVersion: cloudProxyMocks.getAppConfigHostedConfigurationVersion,
    listAppConfigConfigurationProfiles: cloudProxyMocks.listAppConfigConfigurationProfiles,
    listAppConfigDeploymentStrategies: cloudProxyMocks.listAppConfigDeploymentStrategies,
    listAppConfigEnvironments: cloudProxyMocks.listAppConfigEnvironments,
    listAppConfigHostedConfigurationVersions: cloudProxyMocks.listAppConfigHostedConfigurationVersions,
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

describe('AppConfigPanel configuration editor', () => {
    const profile = {id: 'profile-1', applicationId: application.id, name: 'settings', locationUri: 'hosted', type: 'AWS.Freeform'}
    const version = (versionNumber: number, content: string) => ({
        id: `${profile.id}:${versionNumber}`,
        applicationId: application.id,
        configurationProfileId: profile.id,
        versionNumber,
        description: null,
        contentType: 'application/json',
        content,
    })

    beforeEach(() => {
        setAccountId(DEFAULT_ACCOUNT_ID)
        Object.values(cloudProxyMocks).forEach((mock) => mock.mockReset())
        cloudProxyMocks.listAppConfigEnvironments.mockResolvedValue([])
        cloudProxyMocks.listAppConfigDeploymentStrategies.mockResolvedValue([])
        cloudProxyMocks.listAppConfigConfigurationProfiles.mockResolvedValue([profile])
        cloudProxyMocks.listAppConfigHostedConfigurationVersions.mockResolvedValue([version(1, '{"a":1}'), version(2, '{"a":2}')])
        cloudProxyMocks.getAppConfigHostedConfigurationVersion.mockImplementation(
            async (_cloud: string, _app: string, _profile: string, number: number) => version(number, `{"a":${number}}`),
        )
    })

    async function renderWithProfileSelected() {
        const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        const user = userEvent.setup()
        render(
            <QueryClientProvider client={queryClient}>
                <AppConfigPanel cloud="aws" resource={application} runtimeReachable/>
            </QueryClientProvider>,
        )
        await user.click(await screen.findByRole('button', {name: /settings/}))
        return user
    }

    test('opens the latest version in the editor and publishes an edit as a new version', async () => {
        cloudProxyMocks.createAppConfigHostedConfigurationVersion.mockResolvedValue(version(3, '{"a":3}'))
        const user = await renderWithProfileSelected()

        const editor = await screen.findByLabelText('Configuration content')
        await waitFor(() => expect(editor).toHaveValue('{"a":2}'))
        expect(screen.getByText(/\(latest\)/)).toBeInTheDocument()
        expect(screen.getByRole('button', {name: /create new version/i})).toBeDisabled()

        await user.clear(editor)
        await user.type(editor, '{{"a":3}')
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
        await user.click(screen.getByRole('button', {name: /create new version/i}))

        await waitFor(() => expect(cloudProxyMocks.createAppConfigHostedConfigurationVersion).toHaveBeenCalledWith(
            'aws', application.id, profile.id, {content: '{"a":3}', contentType: 'application/json'},
        ))
    })

    test('blocks publishing invalid JSON and can discard the draft', async () => {
        const user = await renderWithProfileSelected()
        const editor = await screen.findByLabelText('Configuration content')
        await waitFor(() => expect(editor).toHaveValue('{"a":2}'))

        await user.type(editor, ' oops')
        expect(await screen.findByText(/Invalid JSON/)).toBeInTheDocument()
        expect(screen.getByRole('button', {name: /create new version/i})).toBeDisabled()

        await user.click(screen.getByRole('button', {name: /discard changes/i}))
        expect(editor).toHaveValue('{"a":2}')
        expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument()
    })

    test('edits from an older version', async () => {
        const user = await renderWithProfileSelected()
        await waitFor(() => expect(screen.getByLabelText('Configuration content')).toHaveValue('{"a":2}'))

        await user.click(await screen.findByTitle('Edit from version 1'))

        await waitFor(() => expect(screen.getByLabelText('Configuration content')).toHaveValue('{"a":1}'))
        expect(screen.getByText(/latest is 2/)).toBeInTheDocument()
    })

    test('does not offer publishing when the current version failed to load', async () => {
        cloudProxyMocks.getAppConfigHostedConfigurationVersion.mockRejectedValue(new Error('load failed'))
        await renderWithProfileSelected()

        expect(await screen.findByText('load failed')).toBeInTheDocument()
        expect(screen.getByLabelText('Configuration content')).toBeDisabled()
        expect(screen.getByRole('button', {name: /create new version/i})).toBeDisabled()
    })

    test('a description alone can be published, and discarding clears it', async () => {
        cloudProxyMocks.createAppConfigHostedConfigurationVersion.mockResolvedValue(version(3, '{"a":2}'))
        const user = await renderWithProfileSelected()
        await waitFor(() => expect(screen.getByLabelText('Configuration content')).toHaveValue('{"a":2}'))

        await user.type(screen.getByLabelText('Version description'), 'no-op release')
        expect(screen.getByRole('button', {name: /create new version/i})).toBeEnabled()

        await user.click(screen.getByRole('button', {name: /discard changes/i}))
        expect(screen.getByLabelText('Version description')).toHaveValue('')
        expect(screen.getByRole('button', {name: /create new version/i})).toBeDisabled()
    })

    test('asks before an older version replaces unsaved edits', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
        const user = await renderWithProfileSelected()
        const editor = await screen.findByLabelText('Configuration content')
        await waitFor(() => expect(editor).toHaveValue('{"a":2}'))
        await user.type(editor, ' ')

        await user.click(screen.getByTitle('Edit from version 1'))
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(editor).toHaveValue('{"a":2} ')

        confirm.mockReturnValue(true)
        await user.click(screen.getByTitle('Edit from version 1'))
        await waitFor(() => expect(editor).toHaveValue('{"a":1}'))
        confirm.mockRestore()
    })
})

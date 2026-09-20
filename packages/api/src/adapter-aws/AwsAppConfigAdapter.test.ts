import {describe, expect, test} from 'bun:test'
import {
    CreateApplicationCommand,
    CreateEnvironmentCommand,
    CreateHostedConfigurationVersionCommand,
    DeleteEnvironmentCommand,
    GetApplicationCommand,
    GetHostedConfigurationVersionCommand,
    ListApplicationsCommand,
    ListConfigurationProfilesCommand,
    ListDeploymentStrategiesCommand,
    ListEnvironmentsCommand,
    StartDeploymentCommand,
    type AppConfigClient,
} from '@aws-sdk/client-appconfig'
import {AwsAppConfigAdapter} from './AwsAppConfigAdapter'
import {ValidationError} from '../cloud-spi/errors'

const APPLICATION = {Id: 'abc123', Name: 'orders', Description: 'Order service'}
const ENVIRONMENT = {ApplicationId: 'abc123', Id: 'env777', Name: 'dev', State: 'READY_FOR_DEPLOYMENT'}
const PROFILE = {ApplicationId: 'abc123', Id: 'prof999', Name: 'settings', LocationUri: 'hosted', Type: 'AWS.Freeform'}
const STRATEGY = {Id: 'strat555', Name: 'immediate', DeploymentDurationInMinutes: 0, GrowthFactor: 100}
const DEPLOYMENT = {
    ApplicationId: 'abc123',
    EnvironmentId: 'env777',
    DeploymentStrategyId: 'strat555',
    ConfigurationProfileId: 'prof999',
    ConfigurationVersion: '1',
    DeploymentNumber: 3,
    State: 'COMPLETE',
}

function stubAppConfig(handlers: Record<string, () => object> = {}) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            for (const [name, handler] of Object.entries(handlers)) {
                if (command.constructor.name === name) return handler()
            }
            return {}
        },
    } as unknown as AppConfigClient
    return {client, sent}
}

describe('AwsAppConfigAdapter', () => {
    test('identifies itself as the AWS configuration adapter', () => {
        const adapter = new AwsAppConfigAdapter(stubAppConfig().client)
        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('configuration')
        expect(adapter.schema().displayName).toBe('AppConfig')
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('allows AWS AppConfig application names up to 255 characters', () => {
        const field = new AwsAppConfigAdapter(stubAppConfig().client).schema().fields[0]
        expect(field.validation?.maxLength).toBe(255)
    })

    test('lists applications as top-level resources', async () => {
        const {client} = stubAppConfig({ListApplicationsCommand: () => ({Items: [APPLICATION]})})
        const [resource] = await new AwsAppConfigAdapter(client).list()

        expect(resource).toMatchObject({
            id: 'abc123',
            name: 'orders',
            cloud: 'aws',
            service: 'configuration',
            type: 'appconfig-application',
        })
        expect(resource.metadata.description).toBe('Order service')
    })

    test('returns null when an application is missing', async () => {
        const missing = () => {
            const error = new Error('not found')
            error.name = 'ResourceNotFoundException'
            throw error
        }
        const {client} = stubAppConfig({GetApplicationCommand: missing})
        await expect(new AwsAppConfigAdapter(client).get('nope')).resolves.toBeNull()
    })

    test('creates an application from name and description', async () => {
        const {client, sent} = stubAppConfig({CreateApplicationCommand: () => APPLICATION})
        const resource = await new AwsAppConfigAdapter(client).create({values: {name: 'orders', description: 'Order service'}})

        expect(resource.id).toBe('abc123')
        expect((sent[0] as CreateApplicationCommand).input).toEqual({Name: 'orders', Description: 'Order service'})
    })

    test('rejects an application create without a name', async () => {
        const adapter = new AwsAppConfigAdapter(stubAppConfig().client)
        await expect(adapter.create({values: {}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('lists environments scoped to an application', async () => {
        const {client, sent} = stubAppConfig({ListEnvironmentsCommand: () => ({Items: [ENVIRONMENT]})})
        const [environment] = await new AwsAppConfigAdapter(client).listAppConfigEnvironments('abc123')

        expect(environment).toEqual({
            id: 'env777',
            applicationId: 'abc123',
            name: 'dev',
            description: null,
            state: 'READY_FOR_DEPLOYMENT',
        })
        expect((sent[0] as ListEnvironmentsCommand).input.ApplicationId).toBe('abc123')
    })

    test('creates an environment under an application', async () => {
        const {client, sent} = stubAppConfig({CreateEnvironmentCommand: () => ENVIRONMENT})
        const environment = await new AwsAppConfigAdapter(client).createAppConfigEnvironment('abc123', {values: {name: 'dev'}})

        expect(environment.id).toBe('env777')
        expect((sent[0] as CreateEnvironmentCommand).input).toEqual({ApplicationId: 'abc123', Name: 'dev'})
    })

    test('deletes an environment by application and environment id', async () => {
        const {client, sent} = stubAppConfig()
        await new AwsAppConfigAdapter(client).deleteAppConfigEnvironment('abc123', 'env777')

        expect((sent[0] as DeleteEnvironmentCommand).input).toEqual({ApplicationId: 'abc123', EnvironmentId: 'env777'})
    })

    test('lists configuration profiles with type and location', async () => {
        const {client} = stubAppConfig({ListConfigurationProfilesCommand: () => ({Items: [PROFILE]})})
        const [profile] = await new AwsAppConfigAdapter(client).listAppConfigConfigurationProfiles('abc123')

        expect(profile).toEqual({
            id: 'prof999',
            applicationId: 'abc123',
            name: 'settings',
            description: null,
            locationUri: 'hosted',
            type: 'AWS.Freeform',
        })
    })

    test('decodes hosted configuration version content to text', async () => {
        const {client} = stubAppConfig({
            GetHostedConfigurationVersionCommand: () => ({
                ...PROFILE,
                ConfigurationProfileId: 'prof999',
                VersionNumber: 1,
                ContentType: 'application/json',
                Content: new TextEncoder().encode('{"theme":"dark"}'),
            }),
        })
        const version = await new AwsAppConfigAdapter(client).getAppConfigHostedConfigurationVersion('abc123', 'prof999', 1)

        expect(version?.content).toBe('{"theme":"dark"}')
        expect(version?.contentType).toBe('application/json')
    })

    test('encodes hosted configuration content as bytes', async () => {
        const {client, sent} = stubAppConfig({CreateHostedConfigurationVersionCommand: () => ({VersionNumber: 2})})
        await new AwsAppConfigAdapter(client).createAppConfigHostedConfigurationVersion('abc123', 'prof999', {
            values: {content: '\n{"theme":"dark"}\n', contentType: 'application/json'},
        })

        const input = (sent[0] as CreateHostedConfigurationVersionCommand).input
        expect(input.ApplicationId).toBe('abc123')
        expect(input.ConfigurationProfileId).toBe('prof999')
        expect(input.ContentType).toBe('application/json')
        expect(input.Content).toEqual(new TextEncoder().encode('\n{"theme":"dark"}\n'))
    })

    test('lists deployment strategies without an application scope', async () => {
        const {client} = stubAppConfig({ListDeploymentStrategiesCommand: () => ({Items: [STRATEGY]})})
        const [strategy] = await new AwsAppConfigAdapter(client).listAppConfigDeploymentStrategies()

        expect(strategy).toEqual({
            id: 'strat555',
            name: 'immediate',
            description: null,
            deploymentDurationInMinutes: 0,
            growthType: null,
            growthFactor: 100,
            finalBakeTimeInMinutes: null,
            replicateTo: null,
        })
    })

    test('starts a deployment with the selected ids', async () => {
        const {client, sent} = stubAppConfig({StartDeploymentCommand: () => DEPLOYMENT})
        const deployment = await new AwsAppConfigAdapter(client).startAppConfigDeployment('abc123', 'env777', {
            values: {
                configurationProfileId: 'prof999',
                configurationVersion: '1',
                deploymentStrategyId: 'strat555',
            },
        })

        expect(deployment.deploymentNumber).toBe(3)
        expect(deployment.state).toBe('COMPLETE')
        expect((sent[0] as StartDeploymentCommand).input).toEqual({
            ApplicationId: 'abc123',
            EnvironmentId: 'env777',
            DeploymentStrategyId: 'strat555',
            ConfigurationProfileId: 'prof999',
            ConfigurationVersion: '1',
        })
    })
})

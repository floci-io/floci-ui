import {
    CreateApplicationCommand,
    CreateConfigurationProfileCommand,
    CreateDeploymentStrategyCommand,
    CreateEnvironmentCommand,
    CreateHostedConfigurationVersionCommand,
    DeleteApplicationCommand,
    DeleteConfigurationProfileCommand,
    DeleteDeploymentStrategyCommand,
    DeleteEnvironmentCommand,
    DeleteHostedConfigurationVersionCommand,
    GetApplicationCommand,
    GetDeploymentCommand,
    GetHostedConfigurationVersionCommand,
    ListApplicationsCommand,
    ListConfigurationProfilesCommand,
    ListDeploymentStrategiesCommand,
    ListEnvironmentsCommand,
    ListHostedConfigurationVersionsCommand,
    StartDeploymentCommand,
    type AppConfigClient,
    type Application,
    type ConfigurationProfile,
    type ConfigurationProfileSummary,
    type Deployment,
    type DeploymentStrategy,
    type Environment,
    type HostedConfigurationVersion,
} from '@aws-sdk/client-appconfig'
import {awsAppConfigSchema} from '../cloud-spi/appConfigSchema'
import {ValidationError} from '../cloud-spi/errors'
import type {
    AppConfigConfigurationProfile,
    AppConfigDeployment,
    AppConfigDeploymentStrategy,
    AppConfigEnvironment,
    AppConfigHostedConfigurationVersion,
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/** AWS AppConfig applications and their nested configuration resources. */
export class AwsAppConfigAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'configuration' as const

    constructor(private readonly appConfig: AppConfigClient) {}

    schema(): ServiceSchema {
        return awsAppConfigSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const applications: Application[] = []
        let nextToken: string | undefined
        do {
            const response = await this.appConfig.send(new ListApplicationsCommand({NextToken: nextToken}))
            applications.push(...(response.Items ?? []))
            nextToken = response.NextToken
        } while (nextToken)

        const resources = applications.map(applicationResource)
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return applicationResource(await this.appConfig.send(new GetApplicationCommand({ApplicationId: id})))
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredValue(input.values.name, 'name')
        const description = stringValue(input.values.description) || undefined
        return applicationResource(
            await this.appConfig.send(new CreateApplicationCommand({Name: name, Description: description})),
        )
    }

    async delete(id: string): Promise<void> {
        await this.appConfig.send(new DeleteApplicationCommand({ApplicationId: id}))
    }

    async listAppConfigEnvironments(applicationId: string): Promise<AppConfigEnvironment[]> {
        const environments: Environment[] = []
        let nextToken: string | undefined
        do {
            const response = await this.appConfig.send(
                new ListEnvironmentsCommand({ApplicationId: applicationId, NextToken: nextToken}),
            )
            environments.push(...(response.Items ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return environments.map((environment) => environmentResource(environment, applicationId))
    }

    async createAppConfigEnvironment(applicationId: string, input: CreateResourceInput): Promise<AppConfigEnvironment> {
        const name = requiredValue(input.values.name, 'name')
        const description = stringValue(input.values.description) || undefined
        return environmentResource(
            await this.appConfig.send(new CreateEnvironmentCommand({ApplicationId: applicationId, Name: name, Description: description})),
            applicationId,
        )
    }

    async deleteAppConfigEnvironment(applicationId: string, environmentId: string): Promise<void> {
        await this.appConfig.send(new DeleteEnvironmentCommand({ApplicationId: applicationId, EnvironmentId: environmentId}))
    }

    async listAppConfigConfigurationProfiles(applicationId: string): Promise<AppConfigConfigurationProfile[]> {
        const profiles: ConfigurationProfileSummary[] = []
        let nextToken: string | undefined
        do {
            const response = await this.appConfig.send(
                new ListConfigurationProfilesCommand({ApplicationId: applicationId, NextToken: nextToken}),
            )
            profiles.push(...(response.Items ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return profiles.map((profile) => profileResource(profile, applicationId))
    }

    async createAppConfigConfigurationProfile(applicationId: string, input: CreateResourceInput): Promise<AppConfigConfigurationProfile> {
        const name = requiredValue(input.values.name, 'name')
        const locationUri = requiredValue(input.values.locationUri, 'locationUri')
        const description = stringValue(input.values.description) || undefined
        const type = stringValue(input.values.type) || 'AWS.Freeform'
        return profileResource(
            await this.appConfig.send(new CreateConfigurationProfileCommand({
                ApplicationId: applicationId,
                Name: name,
                Description: description,
                LocationUri: locationUri,
                Type: type,
            })),
            applicationId,
        )
    }

    async deleteAppConfigConfigurationProfile(applicationId: string, profileId: string): Promise<void> {
        await this.appConfig.send(new DeleteConfigurationProfileCommand({ApplicationId: applicationId, ConfigurationProfileId: profileId}))
    }

    async listAppConfigHostedConfigurationVersions(applicationId: string, profileId: string): Promise<AppConfigHostedConfigurationVersion[]> {
        const versions: HostedConfigurationVersion[] = []
        let nextToken: string | undefined
        do {
            const response = await this.appConfig.send(
                new ListHostedConfigurationVersionsCommand({
                    ApplicationId: applicationId,
                    ConfigurationProfileId: profileId,
                    NextToken: nextToken,
                }),
            )
            versions.push(...(response.Items ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return versions.map((version) => versionResource(version, applicationId, profileId))
    }

    async getAppConfigHostedConfigurationVersion(
        applicationId: string,
        profileId: string,
        versionNumber: number,
    ): Promise<AppConfigHostedConfigurationVersion | null> {
        try {
            const response = await this.appConfig.send(new GetHostedConfigurationVersionCommand({
                ApplicationId: applicationId,
                ConfigurationProfileId: profileId,
                VersionNumber: versionNumber,
            }))
            return versionResource(response, applicationId, profileId)
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async createAppConfigHostedConfigurationVersion(
        applicationId: string,
        profileId: string,
        input: CreateResourceInput,
    ): Promise<AppConfigHostedConfigurationVersion> {
        const content = input.values.content
        if (typeof content !== 'string' || !content.trim()) throw new ValidationError('content is required')
        const contentType = requiredValue(input.values.contentType, 'contentType')
        const description = stringValue(input.values.description) || undefined
        const response = await this.appConfig.send(new CreateHostedConfigurationVersionCommand({
            ApplicationId: applicationId,
            ConfigurationProfileId: profileId,
            Content: new TextEncoder().encode(content),
            ContentType: contentType,
            Description: description,
        }))
        return versionResource(response, applicationId, profileId)
    }

    async deleteAppConfigHostedConfigurationVersion(applicationId: string, profileId: string, versionNumber: number): Promise<void> {
        await this.appConfig.send(new DeleteHostedConfigurationVersionCommand({
            ApplicationId: applicationId,
            ConfigurationProfileId: profileId,
            VersionNumber: versionNumber,
        }))
    }

    async listAppConfigDeploymentStrategies(): Promise<AppConfigDeploymentStrategy[]> {
        const strategies: DeploymentStrategy[] = []
        let nextToken: string | undefined
        do {
            const response = await this.appConfig.send(new ListDeploymentStrategiesCommand({NextToken: nextToken}))
            strategies.push(...(response.Items ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return strategies.map(strategyResource)
    }

    async createAppConfigDeploymentStrategy(input: CreateResourceInput): Promise<AppConfigDeploymentStrategy> {
        const name = requiredValue(input.values.name, 'name')
        const deploymentDurationInMinutes = requiredNumber(input.values.deploymentDurationInMinutes, 'deploymentDurationInMinutes')
        const growthFactor = requiredNumber(input.values.growthFactor, 'growthFactor')
        const description = stringValue(input.values.description) || undefined
        const finalBakeTimeInMinutes = numberValue(input.values.finalBakeTimeInMinutes)
        const response = await this.appConfig.send(new CreateDeploymentStrategyCommand({
            Name: name,
            Description: description,
            DeploymentDurationInMinutes: deploymentDurationInMinutes,
            FinalBakeTimeInMinutes: finalBakeTimeInMinutes ?? 0,
            GrowthFactor: growthFactor,
            ReplicateTo: 'NONE',
        }))
        return strategyResource(response)
    }

    async deleteAppConfigDeploymentStrategy(strategyId: string): Promise<void> {
        await this.appConfig.send(new DeleteDeploymentStrategyCommand({DeploymentStrategyId: strategyId}))
    }

    async startAppConfigDeployment(applicationId: string, environmentId: string, input: CreateResourceInput): Promise<AppConfigDeployment> {
        const configurationProfileId = requiredValue(input.values.configurationProfileId, 'configurationProfileId')
        const configurationVersion = requiredValue(input.values.configurationVersion, 'configurationVersion')
        const deploymentStrategyId = requiredValue(input.values.deploymentStrategyId, 'deploymentStrategyId')
        const description = stringValue(input.values.description) || undefined
        return deploymentResource(await this.appConfig.send(new StartDeploymentCommand({
            ApplicationId: applicationId,
            EnvironmentId: environmentId,
            DeploymentStrategyId: deploymentStrategyId,
            ConfigurationProfileId: configurationProfileId,
            ConfigurationVersion: configurationVersion,
            Description: description,
        })))
    }

    async getAppConfigDeployment(applicationId: string, environmentId: string, deploymentNumber: number): Promise<AppConfigDeployment | null> {
        try {
            return deploymentResource(await this.appConfig.send(new GetDeploymentCommand({
                ApplicationId: applicationId,
                EnvironmentId: environmentId,
                DeploymentNumber: deploymentNumber,
            })))
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async health(): Promise<void> {
        await this.appConfig.send(new ListApplicationsCommand({MaxResults: 1}))
    }
}

function applicationResource(application: Application): CloudResource {
    return {
        id: application.Id ?? '',
        name: application.Name ?? '',
        cloud: 'aws',
        service: 'configuration',
        type: 'appconfig-application',
        region: null,
        createdAt: null,
        status: null,
        metadata: {description: application.Description},
    }
}

function environmentResource(environment: Environment, applicationId: string): AppConfigEnvironment {
    return {
        id: environment.Id ?? '',
        applicationId: environment.ApplicationId ?? applicationId,
        name: environment.Name ?? '',
        description: environment.Description ?? null,
        state: environment.State ?? null,
    }
}

function profileResource(profile: ConfigurationProfile | ConfigurationProfileSummary, applicationId: string): AppConfigConfigurationProfile {
    return {
        id: profile.Id ?? '',
        applicationId: profile.ApplicationId ?? applicationId,
        name: profile.Name ?? '',
        description: 'Description' in profile ? profile.Description ?? null : null,
        locationUri: profile.LocationUri ?? null,
        type: profile.Type ?? null,
    }
}

function versionResource(
    version: HostedConfigurationVersion,
    applicationId: string,
    profileId: string,
): AppConfigHostedConfigurationVersion {
    return {
        id: String(version.VersionNumber ?? ''),
        applicationId: version.ApplicationId ?? applicationId,
        configurationProfileId: version.ConfigurationProfileId ?? profileId,
        versionNumber: version.VersionNumber ?? 0,
        description: version.Description ?? null,
        contentType: version.ContentType ?? null,
        content: version.Content ? new TextDecoder().decode(version.Content) : null,
    }
}

function strategyResource(strategy: DeploymentStrategy): AppConfigDeploymentStrategy {
    return {
        id: strategy.Id ?? '',
        name: strategy.Name ?? '',
        description: strategy.Description ?? null,
        deploymentDurationInMinutes: strategy.DeploymentDurationInMinutes ?? null,
        growthType: strategy.GrowthType ?? null,
        growthFactor: strategy.GrowthFactor ?? null,
        finalBakeTimeInMinutes: strategy.FinalBakeTimeInMinutes ?? null,
        replicateTo: strategy.ReplicateTo ?? null,
    }
}

function deploymentResource(deployment: Deployment): AppConfigDeployment {
    return {
        applicationId: deployment.ApplicationId ?? '',
        environmentId: deployment.EnvironmentId ?? '',
        deploymentNumber: deployment.DeploymentNumber ?? 0,
        configurationProfileId: deployment.ConfigurationProfileId ?? null,
        configurationVersion: deployment.ConfigurationVersion ?? null,
        deploymentStrategyId: deployment.DeploymentStrategyId ?? null,
        state: deployment.State ?? null,
        percentageComplete: deployment.PercentageComplete ?? null,
        startedAt: deployment.StartedAt?.toISOString() ?? null,
        completedAt: deployment.CompletedAt?.toISOString() ?? null,
        description: deployment.Description ?? null,
    }
}

function requiredValue(value: unknown, field: string): string {
    const result = stringValue(value)
    if (!result) throw new ValidationError(`${field} is required`)
    return result
}

function requiredNumber(value: unknown, field: string): number {
    const result = Number(value)
    if (!Number.isFinite(result)) throw new ValidationError(`${field} must be a number`)
    return result
}

function numberValue(value: unknown): number | null {
    const result = Number(value)
    return Number.isFinite(result) ? result : null
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return value.name === 'ResourceNotFoundException' || value.$metadata?.httpStatusCode === 404
}

import {
    CreateEndpointCommand,
    CreateEndpointConfigCommand,
    CreateModelCommand,
    CreateTrainingJobCommand,
    DeleteEndpointCommand,
    DeleteEndpointConfigCommand,
    DeleteModelCommand,
    DescribeEndpointCommand,
    DescribeEndpointConfigCommand,
    DescribeModelCommand,
    DescribeTrainingJobCommand,
    ListEndpointConfigsCommand,
    ListEndpointsCommand,
    ListModelsCommand,
    ListTrainingJobsCommand,
    type CreateEndpointCommandInput,
    type CreateEndpointConfigCommandInput,
    type CreateModelCommandInput,
    type CreateTrainingJobCommandInput,
    type DescribeEndpointCommandOutput,
    type DescribeEndpointConfigCommandOutput,
    type DescribeModelCommandOutput,
    type DescribeTrainingJobCommandOutput,
    type EndpointConfigSummary,
    type EndpointSummary,
    type ModelSummary,
    type SageMakerClient,
    type TrainingJobSummary,
} from '@aws-sdk/client-sagemaker'
import {awsSageMakerSchema} from '../cloud-spi/sageMakerSchema'
import {ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

type SageMakerKind = 'model' | 'endpoint-config' | 'endpoint' | 'training-job'

/** AWS SageMaker AI models, endpoint configs, endpoints, and training jobs. */
export class AwsSageMakerAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'sagemaker' as const

    constructor(private readonly sagemaker: SageMakerClient) {}

    schema(): ServiceSchema {
        return awsSageMakerSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const [models, endpointConfigs, endpoints, trainingJobs] = await Promise.all([
            this.listModels(),
            this.listEndpointConfigs(),
            this.listEndpoints(),
            this.listTrainingJobs(),
        ])
        return filterBySearch([...models, ...endpointConfigs, ...endpoints, ...trainingJobs], query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {kind, name} = parseResourceId(id)
        try {
            switch (kind) {
                case 'model':
                    return modelResource(await this.sagemaker.send(new DescribeModelCommand({ModelName: name})))
                case 'endpoint-config':
                    return endpointConfigResource(await this.sagemaker.send(new DescribeEndpointConfigCommand({EndpointConfigName: name})))
                case 'endpoint':
                    return endpointResource(await this.sagemaker.send(new DescribeEndpointCommand({EndpointName: name})))
                case 'training-job':
                    return trainingJobResource(await this.sagemaker.send(new DescribeTrainingJobCommand({TrainingJobName: name})))
            }
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = requiredValue(input.values.resourceType, 'resourceType') as SageMakerKind
        switch (resourceType) {
            case 'model':
                return this.createModel(input)
            case 'endpoint-config':
                return this.createEndpointConfig(input)
            case 'endpoint':
                return this.createEndpoint(input)
            case 'training-job':
                return this.createTrainingJob(input)
            default:
                throw new ValidationError(`Unsupported SageMaker AI resourceType: ${resourceType}`)
        }
    }

    async delete(id: string): Promise<void> {
        const {kind, name} = parseResourceId(id)
        switch (kind) {
            case 'model':
                await this.sagemaker.send(new DeleteModelCommand({ModelName: name}))
                return
            case 'endpoint-config':
                await this.sagemaker.send(new DeleteEndpointConfigCommand({EndpointConfigName: name}))
                return
            case 'endpoint':
                await this.sagemaker.send(new DeleteEndpointCommand({EndpointName: name}))
                return
            case 'training-job':
                throw new ValidationError('SageMaker AI training jobs cannot be deleted. Use StopTrainingJob from an SDK or CLI for running jobs.')
        }
    }

    async health(): Promise<void> {
        await this.sagemaker.send(new ListModelsCommand({MaxResults: 1}))
    }

    private async listModels(): Promise<CloudResource[]> {
        const summaries: ModelSummary[] = []
        let nextToken: string | undefined
        do {
            const response = await this.sagemaker.send(new ListModelsCommand({NextToken: nextToken, MaxResults: 100}))
            summaries.push(...(response.Models ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return summaries.map(modelResource)
    }

    private async listEndpointConfigs(): Promise<CloudResource[]> {
        const summaries: EndpointConfigSummary[] = []
        let nextToken: string | undefined
        do {
            const response = await this.sagemaker.send(new ListEndpointConfigsCommand({NextToken: nextToken, MaxResults: 100}))
            summaries.push(...(response.EndpointConfigs ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return summaries.map(endpointConfigResource)
    }

    private async listEndpoints(): Promise<CloudResource[]> {
        const summaries: EndpointSummary[] = []
        let nextToken: string | undefined
        do {
            const response = await this.sagemaker.send(new ListEndpointsCommand({NextToken: nextToken, MaxResults: 100}))
            summaries.push(...(response.Endpoints ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return summaries.map(endpointResource)
    }

    private async listTrainingJobs(): Promise<CloudResource[]> {
        const summaries: TrainingJobSummary[] = []
        let nextToken: string | undefined
        do {
            const response = await this.sagemaker.send(new ListTrainingJobsCommand({NextToken: nextToken, MaxResults: 100}))
            summaries.push(...(response.TrainingJobSummaries ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return summaries.map(trainingJobResource)
    }

    private async createModel(input: CreateResourceInput): Promise<CloudResource> {
        const modelName = requiredValue(input.values.modelName, 'modelName')
        const commandInput: CreateModelCommandInput = {
            ModelName: modelName,
            PrimaryContainer: jsonObject<NonNullable<CreateModelCommandInput['PrimaryContainer']>>(
                input.values.primaryContainer,
                'primaryContainer',
            ),
        }
        const executionRoleArn = stringValue(input.values.executionRoleArn)
        if (executionRoleArn) commandInput.ExecutionRoleArn = executionRoleArn
        await this.sagemaker.send(new CreateModelCommand(commandInput))
        return (await this.get(resourceId('model', modelName))) ?? fallbackResource('model', modelName)
    }

    private async createEndpointConfig(input: CreateResourceInput): Promise<CloudResource> {
        const endpointConfigName = requiredValue(input.values.endpointConfigName, 'endpointConfigName')
        const commandInput: CreateEndpointConfigCommandInput = {
            EndpointConfigName: endpointConfigName,
            ProductionVariants: jsonArray<NonNullable<CreateEndpointConfigCommandInput['ProductionVariants']>[number]>(
                input.values.productionVariants,
                'productionVariants',
            ),
        }
        await this.sagemaker.send(new CreateEndpointConfigCommand(commandInput))
        return (await this.get(resourceId('endpoint-config', endpointConfigName))) ?? fallbackResource('endpoint-config', endpointConfigName)
    }

    private async createEndpoint(input: CreateResourceInput): Promise<CloudResource> {
        const endpointName = requiredValue(input.values.endpointName, 'endpointName')
        const endpointConfigName = requiredValue(input.values.endpointConfigNameForEndpoint, 'endpointConfigNameForEndpoint')
        const commandInput: CreateEndpointCommandInput = {EndpointName: endpointName, EndpointConfigName: endpointConfigName}
        await this.sagemaker.send(new CreateEndpointCommand(commandInput))
        return (await this.get(resourceId('endpoint', endpointName))) ?? fallbackResource('endpoint', endpointName)
    }

    private async createTrainingJob(input: CreateResourceInput): Promise<CloudResource> {
        const trainingJobName = requiredValue(input.values.trainingJobName, 'trainingJobName')
        const commandInput: CreateTrainingJobCommandInput = {
            TrainingJobName: trainingJobName,
            AlgorithmSpecification: jsonObject<NonNullable<CreateTrainingJobCommandInput['AlgorithmSpecification']>>(
                input.values.algorithmSpecification,
                'algorithmSpecification',
            ),
            RoleArn: requiredValue(input.values.roleArn, 'roleArn'),
            OutputDataConfig: jsonObject<NonNullable<CreateTrainingJobCommandInput['OutputDataConfig']>>(
                input.values.outputDataConfig,
                'outputDataConfig',
            ),
            ResourceConfig: jsonObject<NonNullable<CreateTrainingJobCommandInput['ResourceConfig']>>(
                input.values.resourceConfig,
                'resourceConfig',
            ),
            StoppingCondition: jsonObject<NonNullable<CreateTrainingJobCommandInput['StoppingCondition']>>(
                input.values.stoppingCondition,
                'stoppingCondition',
            ),
        }
        const inputDataConfig = optionalJsonArray<NonNullable<CreateTrainingJobCommandInput['InputDataConfig']>[number]>(
            input.values.inputDataConfig,
            'inputDataConfig',
        )
        if (inputDataConfig) commandInput.InputDataConfig = inputDataConfig
        await this.sagemaker.send(new CreateTrainingJobCommand(commandInput))
        return (await this.get(resourceId('training-job', trainingJobName))) ?? fallbackResource('training-job', trainingJobName)
    }
}

function modelResource(model: ModelSummary | DescribeModelCommandOutput): CloudResource {
    const name = model.ModelName ?? ''
    return {
        id: resourceId('model', name),
        name,
        cloud: 'aws',
        service: 'sagemaker',
        type: 'sagemaker-model',
        region: null,
        createdAt: dateString(model.CreationTime),
        status: null,
        metadata: {
            kind: 'Model',
            arn: model.ModelArn ?? null,
            primaryContainer: 'PrimaryContainer' in model ? redactContainerDefinition(model.PrimaryContainer) : null,
            containers: 'Containers' in model ? redactContainerDefinitions(model.Containers) : null,
            executionRoleArn: 'ExecutionRoleArn' in model ? model.ExecutionRoleArn ?? null : null,
        },
    }
}

function endpointConfigResource(config: EndpointConfigSummary | DescribeEndpointConfigCommandOutput): CloudResource {
    const name = config.EndpointConfigName ?? ''
    return {
        id: resourceId('endpoint-config', name),
        name,
        cloud: 'aws',
        service: 'sagemaker',
        type: 'sagemaker-endpoint-config',
        region: null,
        createdAt: dateString(config.CreationTime),
        status: null,
        metadata: {
            kind: 'Endpoint config',
            arn: config.EndpointConfigArn ?? null,
            productionVariants: 'ProductionVariants' in config ? config.ProductionVariants ?? null : null,
        },
    }
}

function endpointResource(endpoint: EndpointSummary | DescribeEndpointCommandOutput): CloudResource {
    const name = endpoint.EndpointName ?? ''
    return {
        id: resourceId('endpoint', name),
        name,
        cloud: 'aws',
        service: 'sagemaker',
        type: 'sagemaker-endpoint',
        region: null,
        createdAt: dateString(endpoint.CreationTime),
        status: endpoint.EndpointStatus ?? null,
        metadata: {
            kind: 'Endpoint',
            arn: endpoint.EndpointArn ?? null,
            endpointConfigName: 'EndpointConfigName' in endpoint ? endpoint.EndpointConfigName ?? null : null,
            lastModifiedAt: dateString(endpoint.LastModifiedTime),
            failureReason: 'FailureReason' in endpoint ? endpoint.FailureReason ?? null : null,
        },
    }
}

function trainingJobResource(job: TrainingJobSummary | DescribeTrainingJobCommandOutput): CloudResource {
    const name = job.TrainingJobName ?? ''
    return {
        id: resourceId('training-job', name),
        name,
        cloud: 'aws',
        service: 'sagemaker',
        type: 'sagemaker-training-job',
        region: null,
        createdAt: dateString(job.CreationTime),
        status: job.TrainingJobStatus ?? null,
        metadata: {
            kind: 'Training job',
            arn: job.TrainingJobArn ?? null,
            trainingStartTime: 'TrainingStartTime' in job ? dateString(job.TrainingStartTime) : null,
            trainingEndTime: 'TrainingEndTime' in job ? dateString(job.TrainingEndTime) : null,
            failureReason: 'FailureReason' in job ? job.FailureReason ?? null : null,
            modelArtifacts: 'ModelArtifacts' in job ? job.ModelArtifacts ?? null : null,
        },
    }
}

function fallbackResource(kind: SageMakerKind, name: string): CloudResource {
    return {
        id: resourceId(kind, name),
        name,
        cloud: 'aws',
        service: 'sagemaker',
        type: `sagemaker-${kind}`,
        region: null,
        createdAt: null,
        status: null,
        metadata: {kind: kindLabel(kind), arn: null},
    }
}

function resourceId(kind: SageMakerKind, name: string): string {
    return `${kind}:${name}`
}

function parseResourceId(id: string): {kind: SageMakerKind; name: string} {
    const separator = id.indexOf(':')
    if (separator < 1) throw new ValidationError('SageMaker AI resource id must be kind:name')
    const kind = id.slice(0, separator) as SageMakerKind
    const name = id.slice(separator + 1)
    if (!['model', 'endpoint-config', 'endpoint', 'training-job'].includes(kind) || !name) {
        throw new ValidationError('SageMaker AI resource id must be kind:name')
    }
    return {kind, name}
}

function kindLabel(kind: SageMakerKind): string {
    return {
        model: 'Model',
        'endpoint-config': 'Endpoint config',
        endpoint: 'Endpoint',
        'training-job': 'Training job',
    }[kind]
}

function requiredValue(value: unknown, field: string): string {
    const result = stringValue(value)
    if (!result) throw new ValidationError(`${field} is required`)
    return result
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function jsonObject<T extends object>(value: unknown, field: string): T {
    const parsed = parseJson(value, field)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ValidationError(`${field} must be a JSON object`)
    return parsed as T
}

function jsonArray<T extends object>(value: unknown, field: string): T[] {
    const parsed = parseJson(value, field)
    if (!Array.isArray(parsed)) throw new ValidationError(`${field} must be a JSON array`)
    return parsed as T[]
}

function optionalJsonArray<T extends object>(value: unknown, field: string): T[] | undefined {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return undefined
    return jsonArray(value, field)
}

function parseJson(value: unknown, field: string): unknown {
    if (typeof value !== 'string') return value
    try {
        return JSON.parse(value)
    } catch {
        throw new ValidationError(`${field} must be valid JSON`)
    }
}

function dateString(value: Date | string | undefined): string | null {
    if (!value) return null
    return value instanceof Date ? value.toISOString() : value
}

function redactContainerDefinitions(containers: unknown): unknown {
    if (!Array.isArray(containers)) return null
    return containers.map(redactContainerDefinition)
}

function redactContainerDefinition(container: unknown): unknown {
    if (!container || typeof container !== 'object' || Array.isArray(container)) return container ?? null
    const copy = {...(container as Record<string, unknown>)}
    if (copy.Environment && typeof copy.Environment === 'object' && !Array.isArray(copy.Environment)) {
        copy.Environment = Object.fromEntries(
            Object.keys(copy.Environment as Record<string, unknown>).map((key) => [key, '[redacted]']),
        )
    }
    return copy
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        resource.name.toLowerCase().includes(normalized)
        || String(resource.metadata.kind ?? '').toLowerCase().includes(normalized),
    )
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as {name?: string; message?: string; $metadata?: {httpStatusCode?: number}}
    return value.name === 'ResourceNotFoundException'
        || value.$metadata?.httpStatusCode === 404
        || (value.name === 'ValidationException' && /could not find/i.test(value.message ?? ''))
}

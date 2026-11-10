import {
    BatchGetBuildsCommand,
    BatchGetProjectsCommand,
    type Build,
    type CodeBuildClient,
    CreateProjectCommand,
    DeleteProjectCommand,
    ListBuildsCommand,
    ListProjectsCommand,
    type Project,
    StartBuildCommand,
} from '@aws-sdk/client-codebuild'
import {NotFoundError, NotSupportedError, ValidationError} from '../cloud-spi/errors'
import {
    CODEBUILD_BUILD_LIMIT,
    CODEBUILD_DEFAULT_IMAGE,
    CODEBUILD_KINDS,
    CODEBUILD_NAME_MAX_LENGTH,
    CODEBUILD_NAME_MESSAGE,
    CODEBUILD_NAME_MIN_LENGTH,
    CODEBUILD_NAME_PATTERN,
    type CodeBuildKind,
    awsCodeBuildSchema,
} from '../cloud-spi/codeBuildSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const PROJECT_PREFIX = 'project:'
const BUILD_PREFIX = 'build:'
/** BatchGetProjects and BatchGetBuilds take at most 100 names or ids. */
const BATCH_SIZE = 100

/**
 * CodeBuild projects and builds. The ids carry the kind because the two are
 * separate namespaces: `project:<name>` and `build:<build id>`. A build row is
 * named after its project and build number, and it is the useful part while a
 * script runs, so the status and duration live on it.
 */
export class AwsCodeBuildAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'cicd' as const

    constructor(private readonly codebuild: CodeBuildClient) {}

    schema(): ServiceSchema {
        return awsCodeBuildSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const [projectNames, buildIds] = await Promise.all([this.listProjectNames(), this.listBuildIds()])
        const [projects, builds] = await Promise.all([this.getProjects(projectNames), this.getBuilds(buildIds)])
        return filterBySearch([...projects.map(projectResource), ...builds.map(buildResource)], query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        if (id.startsWith(PROJECT_PREFIX)) {
            const [project] = await this.getProjects([id.slice(PROJECT_PREFIX.length)])
            return project ? projectResource(project) : null
        }
        if (id.startsWith(BUILD_PREFIX)) {
            const [build] = await this.getBuilds([id.slice(BUILD_PREFIX.length)])
            return build ? buildResource(build) : null
        }
        return null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const kind = kindValue(input.values.kind)
        const name = stringValue(input.values.name)
        validateName(name)
        const buildspec = stringValue(input.values.buildspec)

        if (kind === 'build') {
            const {build} = await this.codebuild.send(new StartBuildCommand({
                projectName: name,
                ...(buildspec ? {buildspecOverride: buildspec} : {}),
            }))
            if (!build?.id) throw new NotFoundError(`CodeBuild did not return a build for ${name}`)
            return buildResource(build)
        }

        const serviceRole = stringValue(input.values.serviceRole)
        if (!serviceRole) throw new ValidationError('serviceRole is required')
        await this.codebuild.send(new CreateProjectCommand({
            name,
            source: {type: 'NO_SOURCE', ...(buildspec ? {buildspec} : {})},
            artifacts: {type: 'NO_ARTIFACTS'},
            environment: {
                type: 'LINUX_CONTAINER',
                image: stringValue(input.values.image) || CODEBUILD_DEFAULT_IMAGE,
                computeType: 'BUILD_GENERAL1_SMALL',
            },
            serviceRole,
        }))
        const created = await this.get(`${PROJECT_PREFIX}${name}`)
        if (!created) throw new NotFoundError(`CodeBuild did not return ${name} after creating it`)
        return created
    }

    async delete(id: string): Promise<void> {
        if (id.startsWith(BUILD_PREFIX)) throw new NotSupportedError('CodeBuild builds cannot be deleted')
        if (!id.startsWith(PROJECT_PREFIX)) throw new NotFoundError(`Unknown CodeBuild resource ${id}`)
        await this.codebuild.send(new DeleteProjectCommand({name: id.slice(PROJECT_PREFIX.length)}))
    }

    async health(): Promise<void> {
        await this.codebuild.send(new ListProjectsCommand({}))
    }

    private async listProjectNames(): Promise<string[]> {
        const names: string[] = []
        let nextToken: string | undefined
        do {
            const page = await this.codebuild.send(new ListProjectsCommand({nextToken}))
            names.push(...(page.projects ?? []))
            nextToken = page.nextToken && page.nextToken !== nextToken ? page.nextToken : undefined
        } while (nextToken)
        return names
    }

    /** ListBuilds returns the most recent builds first, so the limit keeps the newest. */
    private async listBuildIds(): Promise<string[]> {
        const ids: string[] = []
        let nextToken: string | undefined
        do {
            const page = await this.codebuild.send(new ListBuildsCommand({nextToken}))
            ids.push(...(page.ids ?? []))
            nextToken = page.nextToken && page.nextToken !== nextToken ? page.nextToken : undefined
        } while (nextToken && ids.length < CODEBUILD_BUILD_LIMIT)
        return ids.slice(0, CODEBUILD_BUILD_LIMIT)
    }

    private async getProjects(names: string[]): Promise<Project[]> {
        const found: Project[] = []
        for (const batch of batches(names)) {
            const {projects = []} = await this.codebuild.send(new BatchGetProjectsCommand({names: batch}))
            found.push(...projects)
        }
        return found
    }

    private async getBuilds(ids: string[]): Promise<Build[]> {
        const found: Build[] = []
        for (const batch of batches(ids)) {
            const {builds = []} = await this.codebuild.send(new BatchGetBuildsCommand({ids: batch}))
            found.push(...builds)
        }
        return found
    }
}

function projectResource(project: Project): CloudResource {
    const name = project.name ?? ''
    return {
        id: `${PROJECT_PREFIX}${name}`,
        name,
        cloud: 'aws',
        service: 'cicd',
        type: 'project',
        region: regionFromArn(project.arn),
        createdAt: project.created?.toISOString() ?? null,
        status: null,
        metadata: {
            provider: 'aws',
            arn: project.arn,
            description: project.description,
            image: project.environment?.image,
            computeType: project.environment?.computeType,
            serviceRole: project.serviceRole,
            source: project.source,
            artifacts: project.artifacts,
            environment: project.environment,
            timeoutInMinutes: project.timeoutInMinutes,
            queuedTimeoutInMinutes: project.queuedTimeoutInMinutes,
            lastModified: project.lastModified?.toISOString(),
            tags: project.tags,
        },
    }
}

function buildResource(build: Build): CloudResource {
    const id = build.id ?? ''
    return {
        id: `${BUILD_PREFIX}${id}`,
        name: build.buildNumber === undefined ? id : `${build.projectName} #${build.buildNumber}`,
        cloud: 'aws',
        service: 'cicd',
        type: 'build',
        region: regionFromArn(build.arn),
        createdAt: build.startTime?.toISOString() ?? null,
        status: build.buildStatus ?? null,
        metadata: {
            provider: 'aws',
            arn: build.arn,
            buildId: id,
            projectName: build.projectName,
            buildNumber: build.buildNumber,
            buildComplete: build.buildComplete,
            currentPhase: build.currentPhase,
            duration: durationLabel(build.startTime, build.endTime),
            startTime: build.startTime?.toISOString(),
            endTime: build.endTime?.toISOString(),
            initiator: build.initiator,
            image: build.environment?.image,
            phases: (build.phases ?? []).map((phase) => ({
                phaseType: phase.phaseType,
                phaseStatus: phase.phaseStatus,
                durationInSeconds: phase.durationInSeconds,
                startTime: phase.startTime?.toISOString(),
                endTime: phase.endTime?.toISOString(),
                contexts: phase.contexts,
            })),
            source: build.source,
            environment: build.environment,
            logs: build.logs,
        },
    }
}

/** A build still running has no end time, so it has no duration yet. */
function durationLabel(start?: Date, end?: Date): string | null {
    if (!start || !end) return null
    const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))
    const minutes = Math.floor(seconds / 60)
    return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

function* batches<T>(items: T[]): Generator<T[]> {
    for (let index = 0; index < items.length; index += BATCH_SIZE) yield items.slice(index, index + BATCH_SIZE)
}

function kindValue(value: unknown): CodeBuildKind {
    const kind = stringValue(value) || 'project'
    if (!(CODEBUILD_KINDS as readonly string[]).includes(kind)) {
        throw new ValidationError(`kind must be one of ${CODEBUILD_KINDS.join(', ')}`)
    }
    return kind as CodeBuildKind
}

function validateName(name: string): void {
    if (!name) throw new ValidationError('name is required')
    if (name.length < CODEBUILD_NAME_MIN_LENGTH || name.length > CODEBUILD_NAME_MAX_LENGTH
        || !new RegExp(CODEBUILD_NAME_PATTERN).test(name)) {
        throw new ValidationError(`name is invalid: ${CODEBUILD_NAME_MESSAGE}`)
    }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        resource.name.toLowerCase().includes(normalized)
        || resource.status?.toLowerCase().includes(normalized))
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

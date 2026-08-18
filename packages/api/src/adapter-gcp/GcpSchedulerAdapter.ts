import {ValidationError} from '../cloud-spi/errors'
import {gcpSchedulerSchema} from '../cloud-spi/schedulerSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-GCP emulator's Cloud Scheduler service. The emulator
 * mirrors the public Cloud Scheduler v1 REST API:
 *
 *   list   GET    /v1/projects/{project}/locations/{location}/jobs      -> {jobs: [...], nextPageToken?: string}
 *   get    GET    /v1/projects/{project}/locations/{location}/jobs/{id} -> Job
 *   create POST   /v1/projects/{project}/locations/{location}/jobs      -> Job
 *   delete DELETE /v1/projects/{project}/locations/{location}/jobs/{id} -> {}
 */
interface GcpSchedulerJob {
    name?: string
    description?: string
    schedule?: string
    timeZone?: string
    state?: string
    httpTarget?: {
        uri?: string
        httpMethod?: string
        headers?: Record<string, string>
        body?: string
    }
    userUpdateTime?: string
    scheduleTime?: string
    lastAttemptTime?: string
}

interface GcpSchedulerJobList {
    jobs?: GcpSchedulerJob[]
    nextPageToken?: string
}

export class GcpSchedulerAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'scheduler' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpSchedulerSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const jobs: GcpSchedulerJob[] = []
        let pageToken: string | undefined

        do {
            const queryParams = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''
            const body: GcpSchedulerJobList | null = await this.client.json<GcpSchedulerJobList>(`${this.jobsPath()}${queryParams}`)
            if (body?.jobs) {
                jobs.push(...body.jobs)
            }
            pageToken = body?.nextPageToken || undefined
        } while (pageToken)

        return filterBySearch(jobs.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const job = await this.client.json<GcpSchedulerJob>(
            `${this.jobsPath()}/${encodeURIComponent(id)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return job ? toResource(job) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const jobName = stringValue(input.values.jobName ?? input.values.name)
        const schedule = stringValue(input.values.schedule)
        const timeZone = stringValue(input.values.timeZone) || 'UTC'
        const targetUri = stringValue(input.values.targetUri ?? input.values.uri)
        const httpMethod = stringValue(input.values.httpMethod) || 'POST'
        const description = stringValue(input.values.description)

        if (!jobName) throw new ValidationError('jobName is required')
        if (!schedule) throw new ValidationError('schedule is required')
        if (!targetUri) throw new ValidationError('targetUri is required')

        const fullName = `projects/${this.client.project}/locations/${this.client.location}/jobs/${jobName}`

        const job = await this.client.json<GcpSchedulerJob>(
            this.jobsPath(),
            {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({
                    name: fullName,
                    description,
                    schedule,
                    timeZone,
                    httpTarget: {
                        uri: targetUri,
                        httpMethod,
                    },
                }),
            },
        )

        return toResource(job ?? {name: fullName, schedule, timeZone, description, httpTarget: {uri: targetUri, httpMethod}})
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(`${this.jobsPath()}/${encodeURIComponent(id)}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    private jobsPath(): string {
        return `/v1/projects/${encodeURIComponent(this.client.project)}/locations/${encodeURIComponent(this.client.location)}/jobs`
    }
}

function toResource(job: GcpSchedulerJob): CloudResource {
    const name = shortName(job.name ?? '')
    const target = job.httpTarget?.uri ?? ''
    return {
        id: name,
        name,
        cloud: 'gcp',
        service: 'scheduler',
        type: 'scheduler-job',
        region: locationOf(job.name ?? ''),
        createdAt: job.userUpdateTime ?? null,
        status: job.state ?? 'ENABLED',
        metadata: {
            provider: 'gcp',
            resourceName: job.name,
            schedule: job.schedule,
            timeZone: job.timeZone,
            target,
            httpMethod: job.httpTarget?.httpMethod,
            description: job.description,
            scheduleTime: job.scheduleTime,
            lastAttemptTime: job.lastAttemptTime,
            userUpdateTime: job.userUpdateTime,
        },
    }
}

function shortName(resourceName: string): string {
    const match = resourceName.match(/jobs\/([^/]+)$/)
    return match ? match[1] : resourceName
}

function locationOf(resourceName: string): string | null {
    const match = resourceName.match(/locations\/([^/]+)/)
    return match ? match[1] : null
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

import {httpStatusToCloudError, NotSupportedError, RuntimeError, RuntimeUnavailableError} from '../cloud-spi/errors'
import {awsSesEmailSchema} from '../cloud-spi/emailSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

interface FlociSesMessage {
    Id?: string
    Region?: string | null
    Source?: string
    Destination?: {
        ToAddresses?: string[]
        CcAddresses?: string[]
        BccAddresses?: string[]
    }
    ReplyToAddresses?: string[]
    Subject?: string
    Body?: {
        text_part?: string | null
        html_part?: string | null
    }
    RawData?: string
    Timestamp?: string
}

interface FlociSesInbox {
    messages?: FlociSesMessage[]
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Adapts Floci's documented SES inspection surface to normalized email resources.
 * It deliberately does not send email: applications under test keep using the
 * AWS SES SDK, and this mailbox shows exactly what the runtime captured.
 */
export class AwsSesAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'email' as const

    constructor(
        private readonly endpoint = process.env.FLOCI_ENDPOINT ?? 'http://localhost:4566',
        private readonly fetcher: FetchLike = globalThis.fetch,
    ) {}

    schema(): ServiceSchema {
        return awsSesEmailSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const messages = await this.fetchInbox()
        const resources = messages.map(messageToResource)
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const messages = await this.fetchInbox(id)
        const message = messages.find((entry) => entry.Id === id)
        return message ? messageToResource(message) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('Sending email from the mailbox is not implemented yet')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('Deleting individual captured emails is not supported by Floci SES')
    }

    async clearEmailInbox(): Promise<void> {
        await this.request('/_aws/ses', {method: 'DELETE'})
    }

    private async fetchInbox(id?: string): Promise<FlociSesMessage[]> {
        const search = id ? `?id=${encodeURIComponent(id)}` : ''
        const response = await this.request(`/_aws/ses${search}`, {method: 'GET'})
        let body: FlociSesInbox
        try {
            body = await response.json() as FlociSesInbox
        } catch (error) {
            throw new RuntimeError('Floci SES inspection returned invalid JSON', {cause: error})
        }
        if (!Array.isArray(body.messages)) {
            throw new RuntimeError('Floci SES inspection response did not contain messages')
        }
        return body.messages
    }

    private async request(path: string, init: RequestInit): Promise<Response> {
        let response: Response
        try {
            response = await this.fetcher(`${this.endpoint.replace(/\/$/, '')}${path}`, init)
        } catch (error) {
            throw new RuntimeUnavailableError(`Cannot reach Floci SES at ${this.endpoint}`, {cause: error})
        }
        if (response.ok) return response

        const detail = await response.text().catch(() => '')
        throw httpStatusToCloudError(
            response.status,
            detail || `Floci SES inspection returned HTTP ${response.status}`,
        )
    }
}

function messageToResource(message: FlociSesMessage): CloudResource {
    const id = message.Id ?? ''
    const raw = typeof message.RawData === 'string'
    return {
        id,
        name: message.Subject?.trim() || '(no subject)',
        cloud: 'aws',
        service: 'email',
        type: 'email',
        region: message.Region ?? null,
        createdAt: message.Timestamp ?? null,
        status: 'captured',
        metadata: {
            provider: 'aws',
            emailService: 'ses',
            source: message.Source ?? null,
            toAddresses: message.Destination?.ToAddresses ?? [],
            ccAddresses: message.Destination?.CcAddresses ?? [],
            bccAddresses: message.Destination?.BccAddresses ?? [],
            replyToAddresses: message.ReplyToAddresses ?? [],
            textBody: message.Body?.text_part ?? null,
            htmlBody: message.Body?.html_part ?? null,
            rawData: message.RawData ?? null,
            messageType: raw ? 'raw' : 'simple',
        },
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => {
        const metadata = resource.metadata
        const searchable = [
            resource.name,
            stringValue(metadata.source),
            ...stringList(metadata.toAddresses),
            ...stringList(metadata.ccAddresses),
            ...stringList(metadata.bccAddresses),
        ].join(' ').toLowerCase()
        return searchable.includes(normalized)
    })
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

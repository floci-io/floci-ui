import {httpStatusToCloudError, NotSupportedError, RuntimeError, RuntimeUnavailableError} from '../cloud-spi/errors'
import {awsSesEmailSchema} from '../cloud-spi/emailSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'
import {cloudEndpoint} from '../service/endpoints'
import PostalMime, {type Address, type Email} from 'postal-mime'

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
        private readonly endpoint = cloudEndpoint('aws'),
        private readonly fetcher: FetchLike = globalThis.fetch,
    ) {}

    schema(): ServiceSchema {
        return awsSesEmailSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const messages = await this.fetchInbox()
        const resources: CloudResource[] = []
        for (const message of messages) resources.push(await messageToResource(message))
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

async function messageToResource(message: FlociSesMessage): Promise<CloudResource> {
    const id = message.Id ?? ''
    const raw = typeof message.RawData === 'string'
    let parsed: Email | undefined
    if (raw && message.RawData) {
        try {
            parsed = await PostalMime.parse(Buffer.from(message.RawData, 'base64'), {
                maxNestingDepth: 20,
                maxHeadersSize: 128 * 1024,
            })
        } catch {
            // A malformed message must not hide the remaining mailbox or its raw data.
        }
    }
    return {
        id,
        name: (message.Subject ?? parsed?.subject)?.trim() || '(no subject)',
        cloud: 'aws',
        service: 'email',
        type: 'email',
        region: message.Region ?? null,
        createdAt: message.Timestamp ?? null,
        status: 'captured',
        metadata: {
            provider: 'aws',
            emailService: 'ses',
            source: message.Source ?? addresses(parsed?.from ? [parsed.from] : [])[0] ?? null,
            toAddresses: message.Destination?.ToAddresses ?? addresses(parsed?.to),
            ccAddresses: message.Destination?.CcAddresses ?? addresses(parsed?.cc),
            bccAddresses: message.Destination?.BccAddresses ?? addresses(parsed?.bcc),
            replyToAddresses: message.ReplyToAddresses ?? addresses(parsed?.replyTo),
            textBody: message.Body?.text_part ?? parsed?.text ?? null,
            htmlBody: message.Body?.html_part ?? parsed?.html ?? null,
            rawData: message.RawData ?? null,
            messageType: raw ? 'raw' : 'simple',
        },
    }
}

function addresses(values: Address[] = []): string[] {
    return values.flatMap(value => value.group ? value.group.map(mailbox => mailbox.address) : [value.address])
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

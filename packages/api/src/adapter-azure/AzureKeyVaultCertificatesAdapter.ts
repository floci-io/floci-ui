import {azure, type AzureRuntimeClient} from '../azure'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    AZURE_CERTIFICATE_CONTENT_TYPES,
    AZURE_CERTIFICATE_NAME_MESSAGE,
    AZURE_CERTIFICATE_NAME_PATTERN,
    AZURE_CERTIFICATE_SHAPES,
    AZURE_CERTIFICATE_STATES,
    AZURE_CERTIFICATE_VALIDITY_MONTHS,
    azureCertificatesSchema,
    type AzureCertificateContentTypeName,
    type AzureCertificateShapeName,
} from '../cloud-spi/certificatesSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const API_VERSION = '7.4'

type CertificateState = (typeof AZURE_CERTIFICATE_STATES)[number]

interface CertificatePolicy {
    key_props?: {kty?: string; key_size?: number; crv?: string; exportable?: boolean; reuse_key?: boolean}
    secret_props?: {contentType?: string}
    x509_props?: {
        subject?: string
        sans?: {dns_names?: string[]; emails?: string[]}
        validity_months?: number
        key_usage?: string[]
        ekus?: string[]
    }
    issuer?: {name?: string}
}

interface CertificateRecord {
    id?: string
    kid?: string
    sid?: string
    x5t?: string
    attributes?: {
        enabled?: boolean
        created?: number
        updated?: number
        exp?: number | null
        nbf?: number | null
        recoveryLevel?: string
        recoverableDays?: number
    }
    tags?: Record<string, string>
    policy?: CertificatePolicy
    recoveryId?: string
    deletedDate?: number
    scheduledPurgeDate?: number
}

interface CertificateListResponse {
    value?: CertificateRecord[]
    nextLink?: string | null
}

export class AzureKeyVaultCertificatesAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'certificates' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureCertificatesSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const state = certificateState(query.filters?.state)
        const collection = state === 'deleted' ? 'deletedcertificates' : 'certificates'
        const records = await this.listAll(`/${collection}?api-version=${API_VERSION}`)

        return filterBySearch(records.map((record) => toCertificateResource(record, '', state)), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const body = await this.keyVaultJson<CertificateRecord>(
            `/certificates/${encodeURIComponent(id)}?api-version=${API_VERSION}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        if (!body) return this.getDeleted(id)

        const resource = toCertificateResource(body, id)
        const records = await this.listAll(`/certificates/${encodeURIComponent(id)}/versions?api-version=${API_VERSION}`)
        resource.metadata.versions = sortVersions(records.map((record) => toVersionEntry(record, resource.version ?? null)))
        return resource
    }

    // Floci-AZ issues the certificate synchronously and answers 202 with a completed operation,
    // so the issued certificate is read back instead of returning the operation.
    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.certificateName ?? input.values.name)
        const shapeName = stringValue(input.values.keyShape) || 'RSA_2048'
        const contentTypeName = stringValue(input.values.contentType) || 'PKCS12'
        const months = Number(stringValue(input.values.validityMonths) || '12')

        if (!name) throw new ValidationError('certificateName is required')
        if (!new RegExp(AZURE_CERTIFICATE_NAME_PATTERN).test(name)) throw new ValidationError(AZURE_CERTIFICATE_NAME_MESSAGE)
        if (!Object.hasOwn(AZURE_CERTIFICATE_SHAPES, shapeName)) {
            throw new ValidationError(`keyShape must be one of: ${Object.keys(AZURE_CERTIFICATE_SHAPES).join(', ')}`)
        }
        if (!Object.hasOwn(AZURE_CERTIFICATE_CONTENT_TYPES, contentTypeName)) {
            throw new ValidationError(`contentType must be one of: ${Object.keys(AZURE_CERTIFICATE_CONTENT_TYPES).join(', ')}`)
        }
        if (!(AZURE_CERTIFICATE_VALIDITY_MONTHS as readonly number[]).includes(months)) {
            throw new ValidationError(`validityMonths must be one of: ${AZURE_CERTIFICATE_VALIDITY_MONTHS.join(', ')}`)
        }

        const shape: {kty: string; keySize?: number; curve?: string} = AZURE_CERTIFICATE_SHAPES[shapeName as AzureCertificateShapeName]
        const dnsNames = stringValue(input.values.dnsNames).split(',').map((value) => value.trim()).filter(Boolean)
        const subject = stringValue(input.values.subject) || `CN=${name}`

        await this.keyVaultJson(
            `/certificates/${encodeURIComponent(name)}/create?api-version=${API_VERSION}`,
            {
                method: 'POST',
                body: JSON.stringify({
                    policy: {
                        issuer: {name: 'Self'},
                        key_props: {
                            kty: shape.kty,
                            ...(shape.keySize ? {key_size: shape.keySize} : {}),
                            ...(shape.curve ? {crv: shape.curve} : {}),
                            exportable: true,
                            reuse_key: false,
                        },
                        secret_props: {contentType: AZURE_CERTIFICATE_CONTENT_TYPES[contentTypeName as AzureCertificateContentTypeName]},
                        x509_props: {
                            subject,
                            validity_months: months,
                            ...(dnsNames.length > 0 ? {sans: {dns_names: dnsNames}} : {}),
                        },
                    },
                }),
            },
        )

        const issued = await this.get(name)
        if (!issued) throw new RuntimeError('Azure Key Vault did not return the issued certificate')
        return issued
    }

    // Key Vault delete is a soft-delete: the certificate moves to the deleted namespace until it is recovered or purged.
    async delete(id: string): Promise<void> {
        await this.keyVaultJson(`/certificates/${encodeURIComponent(id)}?api-version=${API_VERSION}`, {method: 'DELETE'})
    }

    async recover(id: string): Promise<CloudResource> {
        const body = await this.keyVaultJson<CertificateRecord>(
            `/deletedcertificates/${encodeURIComponent(id)}/recover?api-version=${API_VERSION}`,
            {method: 'POST'},
        )

        if (!body) throw new RuntimeError('Azure Key Vault recover returned an empty response')
        return toCertificateResource(body, id)
    }

    async purgeDeleted(id: string): Promise<void> {
        await this.keyVaultJson(`/deletedcertificates/${encodeURIComponent(id)}?api-version=${API_VERSION}`, {method: 'DELETE'})
    }

    private async getDeleted(id: string): Promise<CloudResource | null> {
        const body = await this.keyVaultJson<CertificateRecord>(
            `/deletedcertificates/${encodeURIComponent(id)}?api-version=${API_VERSION}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        return body ? toCertificateResource(body, id, 'deleted') : null
    }

    private async listAll(firstPath: string): Promise<CertificateRecord[]> {
        const records: CertificateRecord[] = []
        const visited = new Set<string>()
        let path: string | null = firstPath

        // A runtime that echoes the current page as its own nextLink would otherwise
        // loop forever, so stop as soon as a page repeats.
        while (path && !visited.has(path)) {
            visited.add(path)
            const body: CertificateListResponse | null = await this.keyVaultJson<CertificateListResponse>(
                path,
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            records.push(...(body?.value ?? []))
            path = body?.nextLink ? keyVaultNextPath(body.nextLink) : null
        }

        return records
    }

    private async keyVaultJson<T>(
        path: string,
        init: RequestInit,
        options?: {emptyOnNotFound?: boolean},
    ): Promise<T | null> {
        const res = await this.client.fetch(
            `/${encodeURIComponent(this.client.accountName)}-keyvault${path}`,
            {
                ...init,
                headers: {
                    accept: 'application/json',
                    authorization: 'Bearer floci-ui',
                    'content-type': 'application/json',
                    ...(init.headers ?? {}),
                },
            },
            {...options, includeStorageApiVersion: false},
        )

        if (!res || res.status === 204) return null
        const text = await res.text()
        return text ? JSON.parse(text) as T : null
    }
}

function keyVaultNextPath(nextLink: string): string {
    try {
        const url = new URL(nextLink)
        return `${url.pathname}${url.search}`
    } catch {
        return nextLink.startsWith('/') ? nextLink : `/${nextLink}`
    }
}

function toCertificateResource(record: CertificateRecord, fallbackName = '', state: CertificateState = 'active'): CloudResource {
    const parsed = parseCertificateId(record.id)
    const name = parsed.name || fallbackName
    const attributes = record.attributes ?? {}
    const policy = record.policy ?? {}
    const keyProps = policy.key_props ?? {}
    const x509 = policy.x509_props ?? {}

    return {
        id: name,
        name,
        cloud: 'azure',
        service: 'certificates',
        type: 'certificate',
        region: null,
        createdAt: epochDate(attributes.created),
        status: state === 'deleted' ? 'deleted' : attributes.enabled === false ? 'disabled' : 'enabled',
        version: parsed.version,
        metadata: {
            provider: 'azure',
            // List entries carry no policy or key and secret identifiers, so those fields are null in the list.
            subject: x509.subject ?? null,
            dnsNames: x509.sans?.dns_names ?? [],
            keyShapeLabel: describeShape(keyProps),
            exportable: keyProps.exportable ?? null,
            validityMonths: x509.validity_months ?? null,
            secretFormat: policy.secret_props?.contentType ?? null,
            issuer: policy.issuer?.name ?? null,
            thumbprint: record.x5t ?? null,
            keyId: record.kid ?? null,
            secretId: record.sid ?? null,
            enabled: attributes.enabled !== false,
            updatedAt: epochDate(attributes.updated),
            expiresAt: epochDate(attributes.exp),
            notBefore: epochDate(attributes.nbf),
            recoveryLevel: attributes.recoveryLevel,
            recoverableDays: attributes.recoverableDays,
            tags: Object.entries(record.tags ?? {}).map(([key, value]) => ({key, value})),
            ...(state === 'deleted'
                ? {deletedAt: epochDate(record.deletedDate), scheduledPurgeAt: epochDate(record.scheduledPurgeDate)}
                : {}),
        },
    }
}

function describeShape(keyProps: NonNullable<CertificatePolicy['key_props']>): string | null {
    if (keyProps.kty === 'RSA') return `RSA ${keyProps.key_size}`
    if (keyProps.kty === 'EC') return `EC ${keyProps.crv}`
    return null
}

function toVersionEntry(record: CertificateRecord, current: string | null) {
    const version = parseCertificateId(record.id).version
    const attributes = record.attributes ?? {}

    return {
        version,
        enabled: attributes.enabled !== false,
        createdAt: epochDate(attributes.created),
        updatedAt: epochDate(attributes.updated),
        expiresAt: epochDate(attributes.exp),
        notBefore: epochDate(attributes.nbf),
        current: current === null ? null : version === current,
    }
}

// Key Vault does not document an order for the versions list, so show the newest
// first by creation time and keep the runtime's order for versions created in the same second.
function sortVersions<T extends {createdAt: string | null}>(entries: T[]): T[] {
    return entries
        .map((entry, index) => ({entry, index}))
        .sort((a, b) => (b.entry.createdAt ?? '').localeCompare(a.entry.createdAt ?? '') || a.index - b.index)
        .map(({entry}) => entry)
}

function certificateState(value: string | undefined): CertificateState {
    if (!value) return 'active'
    if ((AZURE_CERTIFICATE_STATES as readonly string[]).includes(value)) return value as CertificateState
    throw new ValidationError(`state must be one of: ${AZURE_CERTIFICATE_STATES.join(', ')}`)
}

function parseCertificateId(id?: string): {name: string; version: string | null} {
    if (!id) return {name: '', version: null}
    // Ids are <host>/certificates/<name>/<version>; read by position because a certificate may be named "certificates".
    const [, name, version] = (id.includes('://') ? new URL(id).pathname : id).split('/').filter(Boolean)
    return {
        name: name ? decodeURIComponent(name) : '',
        version: version ? decodeURIComponent(version) : null,
    }
}

function epochDate(value?: number | null): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return new Date(value * 1000).toISOString()
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

import {
    type ACMClient,
    type CertificateDetail,
    type CertificateSummary,
    DeleteCertificateCommand,
    DescribeCertificateCommand,
    ImportCertificateCommand,
    ListCertificatesCommand,
    ListTagsForCertificateCommand,
    RequestCertificateCommand,
} from '@aws-sdk/client-acm'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    ACM_DOMAIN_NAME_MAX_LENGTH,
    ACM_KEY_ALGORITHMS,
    ACM_MAX_SUBJECT_ALTERNATIVE_NAMES,
    ACM_SOURCES,
    ACM_VALIDATION_METHODS,
    awsCertificatesSchema,
} from '../cloud-spi/certificatesSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

type CertificateTag = {key: string; value: string}

/** Tags plus whether the lookup itself failed, so an untagged certificate and an unreadable one stay distinguishable. */
type TagLookup = {tags: CertificateTag[]; unavailable?: true}

/** ListCertificates accepts up to 1000 per page. */
const LIST_PAGE_SIZE = 1000

export class AwsAcmAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'certificates' as const

    constructor(private readonly acm: ACMClient) {}

    schema(): ServiceSchema {
        return awsCertificatesSchema()
    }

    /** The summary already carries every column, so listing costs one call per page, not one per certificate. */
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const summaries: CertificateSummary[] = []
        let nextToken: string | undefined

        do {
            const res = await this.acm.send(
                new ListCertificatesCommand({MaxItems: LIST_PAGE_SIZE, ...(nextToken ? {NextToken: nextToken} : {})}),
            )
            summaries.push(...(res.CertificateSummaryList ?? []))
            nextToken = res.NextToken
        } while (nextToken)

        return filterBySearch(summaries.map(summaryToResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const detail = await this.describe(id)
        if (!detail) return null
        return detailToResource(detail, await this.getTags(id))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const source = oneOf(input.values.source, ACM_SOURCES, 'source')
        const arn = source === 'IMPORT' ? await this.importCertificate(input) : await this.requestCertificate(input)

        const created = await this.get(arn)
        if (!created) throw new RuntimeError('ACM did not return the certificate it just created')
        return created
    }

    /** ACM deletes immediately, and refuses a certificate that is in use. */
    async delete(id: string): Promise<void> {
        await this.acm.send(new DeleteCertificateCommand({CertificateArn: id}))
    }

    private async requestCertificate(input: CreateResourceInput): Promise<string> {
        const domainName = requiredString(input.values.domainName, 'domainName')
        if (domainName.length > ACM_DOMAIN_NAME_MAX_LENGTH) {
            throw new ValidationError(`domainName must be ${ACM_DOMAIN_NAME_MAX_LENGTH} characters or fewer`)
        }
        const names = splitNames(input.values.subjectAlternativeNames)
        if (names.length > ACM_MAX_SUBJECT_ALTERNATIVE_NAMES) {
            throw new ValidationError(
                `subjectAlternativeNames takes at most ${ACM_MAX_SUBJECT_ALTERNATIVE_NAMES} names`,
            )
        }

        const res = await this.acm.send(
            new RequestCertificateCommand({
                DomainName: domainName,
                ...(names.length > 0 ? {SubjectAlternativeNames: names} : {}),
                ValidationMethod: oneOf(input.values.validationMethod, ACM_VALIDATION_METHODS, 'validationMethod'),
                KeyAlgorithm: oneOf(input.values.keyAlgorithm, ACM_KEY_ALGORITHMS, 'keyAlgorithm'),
            }),
        )
        if (!res.CertificateArn) throw new RuntimeError('ACM did not return a certificate ARN')
        return res.CertificateArn
    }

    private async importCertificate(input: CreateResourceInput): Promise<string> {
        const chain = optionalString(input.values.certificateChain, 'certificateChain')
        const res = await this.acm.send(
            new ImportCertificateCommand({
                Certificate: pem(requiredString(input.values.certificate, 'certificate')),
                PrivateKey: pem(requiredString(input.values.privateKey, 'privateKey')),
                ...(chain ? {CertificateChain: pem(chain)} : {}),
            }),
        )
        if (!res.CertificateArn) throw new RuntimeError('ACM did not return a certificate ARN')
        return res.CertificateArn
    }

    private async describe(id: string): Promise<CertificateDetail | null> {
        try {
            const res = await this.acm.send(new DescribeCertificateCommand({CertificateArn: id}))
            return res.Certificate ?? null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    /**
     * Tags are enrichment, so a failure degrades the inspector rather than the
     * request, and is reported so it cannot pass for an untagged certificate.
     */
    private async getTags(id: string): Promise<TagLookup> {
        try {
            const res = await this.acm.send(new ListTagsForCertificateCommand({CertificateArn: id}))
            return {tags: (res.Tags ?? []).map((tag) => ({key: tag.Key ?? '', value: tag.Value ?? ''}))}
        } catch {
            return {tags: [], unavailable: true}
        }
    }
}

function summaryToResource(summary: CertificateSummary): CloudResource {
    const arn = summary.CertificateArn ?? ''

    return {
        id: arn,
        name: summary.DomainName ?? arn,
        cloud: 'aws',
        service: 'certificates',
        type: 'certificate',
        region: regionFromArn(arn),
        createdAt: isoDate(summary.CreatedAt),
        status: summary.Status ?? null,
        metadata: {
            arn,
            domainName: summary.DomainName,
            subjectAlternativeNames: summary.SubjectAlternativeNameSummaries,
            type: summary.Type,
            keyAlgorithm: summary.KeyAlgorithm,
            inUse: summary.InUse,
            renewalEligibility: summary.RenewalEligibility,
            notBefore: isoDate(summary.NotBefore),
            notAfter: isoDate(summary.NotAfter),
            issuedAt: isoDate(summary.IssuedAt),
            importedAt: isoDate(summary.ImportedAt),
        },
    }
}

function detailToResource(detail: CertificateDetail, tagLookup: TagLookup): CloudResource {
    const arn = detail.CertificateArn ?? ''

    return {
        id: arn,
        name: detail.DomainName ?? arn,
        cloud: 'aws',
        service: 'certificates',
        type: 'certificate',
        region: regionFromArn(arn),
        createdAt: isoDate(detail.CreatedAt),
        status: detail.Status ?? null,
        metadata: {
            arn,
            domainName: detail.DomainName,
            subjectAlternativeNames: detail.SubjectAlternativeNames,
            subject: detail.Subject,
            issuer: detail.Issuer,
            serial: detail.Serial,
            type: detail.Type,
            keyAlgorithm: detail.KeyAlgorithm,
            signatureAlgorithm: detail.SignatureAlgorithm,
            inUseBy: detail.InUseBy,
            renewalEligibility: detail.RenewalEligibility,
            notBefore: isoDate(detail.NotBefore),
            notAfter: isoDate(detail.NotAfter),
            issuedAt: isoDate(detail.IssuedAt),
            importedAt: isoDate(detail.ImportedAt),
            failureReason: detail.FailureReason,
            validation: (detail.DomainValidationOptions ?? []).map((option) => ({
                domainName: option.DomainName,
                status: option.ValidationStatus,
                method: option.ValidationMethod,
            })),
            tags: tagLookup.tags,
            ...(tagLookup.unavailable ? {tagsUnavailable: true} : {}),
        },
    }
}

/** `arn:aws:acm:us-east-1:000000000000:certificate/<uuid>`: the region is the 4th field. */
function regionFromArn(arn: string): string | null {
    return arn.split(':')[3] || null
}

function isoDate(value: Date | undefined): string | null {
    return value ? value.toISOString() : null
}

/** Matches the domain, any additional name and the ARN, because the ARN is an opaque uuid. */
function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources

    return resources.filter((resource) => {
        const names = (resource.metadata.subjectAlternativeNames as string[] | undefined) ?? []
        return [resource.name, resource.id, ...names].some((value) => value.toLowerCase().includes(normalized))
    })
}

function splitNames(value: unknown): string[] {
    const raw = optionalString(value, 'subjectAlternativeNames')
    if (!raw) return []
    return raw
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value
}

function requiredString(value: unknown, field: string): string {
    const raw = optionalString(value, field)?.trim()
    if (!raw) throw new ValidationError(`${field} is required`)
    return raw
}

/** ACM takes the PEM as bytes. */
function pem(value: string): Uint8Array {
    return new TextEncoder().encode(value)
}

/** Keeps create honest about the schema: a value the form never offers fails here with a typed error. */
function oneOf<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
    const raw = optionalString(value, field)
    if (raw === undefined) return allowed[0] as T[number]
    if (!allowed.includes(raw)) {
        throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
    }
    return raw as T[number]
}

/** ACM reports a missing certificate as ResourceNotFoundException; match the name, not only the emulator's status. */
function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    if ((error as {name?: string}).name === 'ResourceNotFoundException') return true
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === 404
}

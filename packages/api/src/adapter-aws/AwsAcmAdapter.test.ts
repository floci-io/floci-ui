import {describe, expect, test} from 'bun:test'
import {
    type ACMClient,
    DeleteCertificateCommand,
    DescribeCertificateCommand,
    ImportCertificateCommand,
    ListCertificatesCommand,
    ListTagsForCertificateCommand,
    RequestCertificateCommand,
} from '@aws-sdk/client-acm'
import {AwsAcmAdapter} from './AwsAcmAdapter'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

/** Minimal ACMClient stub that records the commands it was sent. */
function stubAcm(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as ACMClient
    return {client, sent}
}

const ARN = 'arn:aws:acm:us-east-1:000000000000:certificate/743621b7-cb6e-4d11-91e9-1b5eb379a741'
const OTHER_ARN = 'arn:aws:acm:us-east-1:000000000000:certificate/db7a9ca4-bfb5-4e31-95e2-c1ae076cde23'

const summary = {
    CertificateArn: ARN,
    DomainName: 'example.com',
    SubjectAlternativeNameSummaries: ['example.com', 'www.example.com', '*.example.com'],
    Status: 'ISSUED',
    Type: 'AMAZON_ISSUED',
    KeyAlgorithm: 'RSA-2048',
    InUse: false,
    RenewalEligibility: 'INELIGIBLE',
    NotBefore: new Date('2026-10-27T22:51:30.000Z'),
    NotAfter: new Date('2027-10-27T22:51:29.000Z'),
    CreatedAt: new Date('2026-10-27T22:51:30.077Z'),
}

const detail = {
    CertificateArn: ARN,
    DomainName: 'example.com',
    SubjectAlternativeNames: ['example.com', 'www.example.com', '*.example.com'],
    DomainValidationOptions: [
        {DomainName: 'example.com', ValidationStatus: 'SUCCESS', ValidationMethod: 'DNS'},
        {DomainName: 'www.example.com', ValidationStatus: 'SUCCESS', ValidationMethod: 'DNS'},
    ],
    Serial: '90:72:a6:ba',
    Subject: 'CN=example.com',
    Issuer: 'CN=Floci Local CA',
    CreatedAt: new Date('2026-10-27T22:51:30.077Z'),
    IssuedAt: new Date('2026-10-27T22:51:30.077Z'),
    Status: 'ISSUED',
    NotBefore: new Date('2026-10-27T22:51:30.000Z'),
    NotAfter: new Date('2027-10-27T22:51:29.000Z'),
    KeyAlgorithm: 'RSA-2048',
    SignatureAlgorithm: 'SHA512WITHRSA',
    InUseBy: [],
    Type: 'AMAZON_ISSUED',
    RenewalEligibility: 'INELIGIBLE',
}

/** Routes each command to the response the real runtime gives for it. */
function runtimeStub(overrides: Record<string, SendResult | (() => never)> = {}) {
    const respond = (key: string, fallback: SendResult): SendResult => {
        const value = overrides[key]
        if (typeof value === 'function') return value()
        return value ?? fallback
    }
    return stubAcm((command) => {
        if (command instanceof ListCertificatesCommand) return respond('list', {CertificateSummaryList: [summary]})
        if (command instanceof DescribeCertificateCommand) return respond('describe', {Certificate: detail})
        if (command instanceof ListTagsForCertificateCommand) return respond('tags', {Tags: []})
        if (command instanceof RequestCertificateCommand) return respond('request', {CertificateArn: ARN})
        if (command instanceof ImportCertificateCommand) return respond('import', {CertificateArn: OTHER_ARN})
        return {}
    })
}

function notFound(): never {
    throw Object.assign(new Error('The certificate does not exist.'), {
        name: 'ResourceNotFoundException',
        $metadata: {httpStatusCode: 400},
    })
}

describe('AwsAcmAdapter', () => {
    test('identifies itself as the AWS certificates adapter', () => {
        const adapter = new AwsAcmAdapter(runtimeStub().client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('certificates')
        expect(adapter.schema().cloud).toBe('aws')
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    describe('list', () => {
        test('returns the empty list when the account has no certificates', async () => {
            const {client} = runtimeStub({list: {CertificateSummaryList: []}})

            expect(await new AwsAcmAdapter(client).list()).toEqual([])
        })

        test('maps the summary onto the table columns without a describe call per certificate', async () => {
            const {client, sent} = runtimeStub()

            const [row] = await new AwsAcmAdapter(client).list()

            expect(sent).toHaveLength(1)
            expect(row).toMatchObject({
                id: ARN,
                name: 'example.com',
                cloud: 'aws',
                service: 'certificates',
                type: 'certificate',
                region: 'us-east-1',
                status: 'ISSUED',
                createdAt: '2026-10-27T22:51:30.077Z',
            })
            expect(row?.metadata).toMatchObject({
                type: 'AMAZON_ISSUED',
                keyAlgorithm: 'RSA-2048',
                notAfter: '2027-10-27T22:51:29.000Z',
            })
        })

        test('follows NextToken so a long account is not truncated', async () => {
            const pages = [
                {CertificateSummaryList: [summary], NextToken: 'page-2'},
                {CertificateSummaryList: [{...summary, CertificateArn: OTHER_ARN, DomainName: 'other.dev'}]},
            ]
            const {client, sent} = stubAcm(() => pages.shift() ?? {})

            const rows = await new AwsAcmAdapter(client).list()

            expect(rows.map((row) => row.name)).toEqual(['example.com', 'other.dev'])
            expect((sent[1] as ListCertificatesCommand).input.NextToken).toBe('page-2')
        })

        test('searches the domain, the additional names and the ARN', async () => {
            const list = {
                CertificateSummaryList: [
                    summary,
                    {...summary, CertificateArn: OTHER_ARN, DomainName: 'other.dev', SubjectAlternativeNameSummaries: ['other.dev']},
                ],
            }
            const adapter = new AwsAcmAdapter(runtimeStub({list}).client)

            expect((await adapter.list({search: 'WWW.'})).map((row) => row.name)).toEqual(['example.com'])
            expect((await adapter.list({search: 'other'})).map((row) => row.name)).toEqual(['other.dev'])
            expect((await adapter.list({search: 'db7a9ca4'})).map((row) => row.name)).toEqual(['other.dev'])
            expect(await adapter.list({search: 'nothing'})).toEqual([])
        })
    })

    describe('get', () => {
        test('shows the names, issuer and validity the inspector needs', async () => {
            const {client} = runtimeStub({tags: {Tags: [{Key: 'env', Value: 'dev'}]}})

            const resource = await new AwsAcmAdapter(client).get(ARN)

            expect(resource?.metadata).toMatchObject({
                subjectAlternativeNames: ['example.com', 'www.example.com', '*.example.com'],
                subject: 'CN=example.com',
                issuer: 'CN=Floci Local CA',
                notBefore: '2026-10-27T22:51:30.000Z',
                notAfter: '2027-10-27T22:51:29.000Z',
                signatureAlgorithm: 'SHA512WITHRSA',
                tags: [{key: 'env', value: 'dev'}],
            })
            expect(resource?.metadata.validation).toEqual([
                {domainName: 'example.com', status: 'SUCCESS', method: 'DNS'},
                {domainName: 'www.example.com', status: 'SUCCESS', method: 'DNS'},
            ])
        })

        test('returns null for a certificate that does not exist', async () => {
            const {client} = runtimeStub({describe: notFound})

            expect(await new AwsAcmAdapter(client).get(ARN)).toBeNull()
        })

        test('treats an emulator 404 without the error name as not found too', async () => {
            const {client} = stubAcm(() => {
                throw Object.assign(new Error('missing'), {name: 'UnknownError', $metadata: {httpStatusCode: 404}})
            })

            expect(await new AwsAcmAdapter(client).get(ARN)).toBeNull()
        })

        test('does not hide a real failure behind null', async () => {
            const {client} = stubAcm(() => {
                throw Object.assign(new Error('boom'), {name: 'ServiceUnavailable', $metadata: {httpStatusCode: 503}})
            })

            await expect(new AwsAcmAdapter(client).get(ARN)).rejects.toThrow('boom')
        })

        test('keeps the certificate when the tag lookup fails, and says the tags are unknown', async () => {
            const {client} = runtimeStub({
                tags: () => {
                    throw new Error('throttled')
                },
            })

            const resource = await new AwsAcmAdapter(client).get(ARN)

            expect(resource?.name).toBe('example.com')
            expect(resource?.metadata.tags).toEqual([])
            expect(resource?.metadata.tagsUnavailable).toBe(true)
        })
    })

    describe('create', () => {
        test('requests a certificate with its additional names, validation method and key algorithm', async () => {
            const {client, sent} = runtimeStub()

            const created = await new AwsAcmAdapter(client).create({
                values: {
                    source: 'REQUEST',
                    domainName: ' example.com ',
                    subjectAlternativeNames: 'www.example.com, *.example.com,,',
                    validationMethod: 'EMAIL',
                    keyAlgorithm: 'EC_prime256v1',
                },
            })

            const request = sent.find((command) => command instanceof RequestCertificateCommand) as RequestCertificateCommand
            expect(request.input).toEqual({
                DomainName: 'example.com',
                SubjectAlternativeNames: ['www.example.com', '*.example.com'],
                ValidationMethod: 'EMAIL',
                KeyAlgorithm: 'EC_prime256v1',
            })
            expect(created.id).toBe(ARN)
        })

        test('defaults to a DNS-validated RSA 2048 request and omits empty additional names', async () => {
            const {client, sent} = runtimeStub()

            await new AwsAcmAdapter(client).create({values: {domainName: 'example.com'}})

            const request = sent.find((command) => command instanceof RequestCertificateCommand) as RequestCertificateCommand
            expect(request.input).toEqual({
                DomainName: 'example.com',
                ValidationMethod: 'DNS',
                KeyAlgorithm: 'RSA_2048',
            })
        })

        test('imports a PEM certificate with its private key and chain as bytes', async () => {
            const {client, sent} = runtimeStub()

            const created = await new AwsAcmAdapter(client).create({
                values: {source: 'IMPORT', certificate: 'CERT-PEM', privateKey: 'KEY-PEM', certificateChain: 'CHAIN-PEM'},
            })

            const imported = sent.find((command) => command instanceof ImportCertificateCommand) as ImportCertificateCommand
            expect(new TextDecoder().decode(imported.input.Certificate as Uint8Array)).toBe('CERT-PEM')
            expect(new TextDecoder().decode(imported.input.PrivateKey as Uint8Array)).toBe('KEY-PEM')
            expect(new TextDecoder().decode(imported.input.CertificateChain as Uint8Array)).toBe('CHAIN-PEM')
            expect(sent.some((command) => command instanceof RequestCertificateCommand)).toBe(false)
            expect(created.id).toBe(ARN)
        })

        test('leaves the chain out of an import that has none', async () => {
            const {client, sent} = runtimeStub()

            await new AwsAcmAdapter(client).create({values: {source: 'IMPORT', certificate: 'C', privateKey: 'K'}})

            const imported = sent.find((command) => command instanceof ImportCertificateCommand) as ImportCertificateCommand
            expect('CertificateChain' in imported.input).toBe(false)
        })

        test('rejects bad input with a validation error before calling ACM', async () => {
            const {client, sent} = runtimeStub()
            const adapter = new AwsAcmAdapter(client)

            await expect(adapter.create({values: {}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter.create({values: {domainName: 'a'.repeat(254)}})).rejects.toBeInstanceOf(ValidationError)
            await expect(
                adapter.create({values: {domainName: 'example.com', keyAlgorithm: 'RSA_1024'}}),
            ).rejects.toBeInstanceOf(ValidationError)
            await expect(
                adapter.create({values: {domainName: 'example.com', validationMethod: 'HTTP'}}),
            ).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter.create({values: {source: 'COPY'}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter.create({values: {source: 'IMPORT', certificate: 'C'}})).rejects.toBeInstanceOf(
                ValidationError,
            )
            await expect(
                adapter.create({values: {domainName: 'example.com', subjectAlternativeNames: Array(100).fill('a.dev').join(',')}}),
            ).rejects.toBeInstanceOf(ValidationError)
            expect(sent).toHaveLength(0)
        })

        test('fails loudly when ACM returns no ARN', async () => {
            const {client} = runtimeStub({request: {}})

            await expect(new AwsAcmAdapter(client).create({values: {domainName: 'example.com'}})).rejects.toBeInstanceOf(
                RuntimeError,
            )
        })
    })

    test('deletes by ARN', async () => {
        const {client, sent} = runtimeStub()

        await new AwsAcmAdapter(client).delete(ARN)

        expect((sent[0] as DeleteCertificateCommand).input).toEqual({CertificateArn: ARN})
    })
})

import {describe, expect, test} from 'bun:test'
import {
    CreateAliasCommand,
    CreateKeyCommand,
    DeleteAliasCommand,
    DeleteKeyCommand,
    GetAliasCommand,
    GetKeyCommand,
    ListAliasesCommand,
    GetPublicKeyCertificateCommand,
    ListKeysCommand,
    ListTagsForResourceCommand,
    type PaymentCryptographyClient,
    TagResourceCommand,
    UntagResourceCommand,
} from '@aws-sdk/client-payment-cryptography'
import {AwsPaymentCryptographyAdapter} from './AwsPaymentCryptographyAdapter'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

/** Minimal PaymentCryptographyClient stub that records the commands it was sent. */
function stubClient(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as PaymentCryptographyClient
    return {client, sent}
}

const ARN = 'arn:aws:payment-cryptography:us-east-1:000000000000:key/4a1b2c3d4e5f60718293a4b5c6d7e8f9'
const OTHER_ARN = 'arn:aws:payment-cryptography:us-east-1:000000000000:key/9f8e7d6c5b4a39281706f5e4d3c2b1a0'

/** A resource id carries the kind it is, because the explorer holds both in one table. */
const KEY_ID = `key/${ARN}`
const OTHER_KEY_ID = `key/${OTHER_ARN}`
const ALIAS_NAME = 'alias/ExampleAlias'
const ALIAS_ID = 'alias/ExampleAlias'

const attributes = {
    KeyClass: 'SYMMETRIC_KEY',
    KeyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY',
    KeyAlgorithm: 'AES_256',
    KeyModesOfUse: {Encrypt: true, Decrypt: true, Wrap: true, Unwrap: true, DeriveKey: false, Sign: false, Verify: false, Generate: false, NoRestrictions: false},
}

const alias = {
    AliasName: ALIAS_NAME,
    KeyArn: ARN,
}

const key = {
    KeyArn: ARN,
    KeyAttributes: attributes,
    KeyCheckValue: '3F2A1B',
    KeyCheckValueAlgorithm: 'CMAC',
    Enabled: true,
    Exportable: false,
    KeyState: 'CREATE_COMPLETE',
    KeyOrigin: 'AWS_PAYMENT_CRYPTOGRAPHY',
    CreateTimestamp: new Date('2026-11-04T09:15:00.000Z'),
}

/** Routes each command to the response the real runtime gives for it. */
function runtimeStub(overrides: Record<string, SendResult | (() => never)> = {}) {
    const respond = (name: string, fallback: SendResult): SendResult => {
        const value = overrides[name]
        if (typeof value === 'function') return value()
        return value ?? fallback
    }
    return stubClient((command) => {
        if (command instanceof ListKeysCommand) return respond('list', {Keys: [key]})
        if (command instanceof GetKeyCommand) return respond('get', {Key: key})
        if (command instanceof CreateKeyCommand) return respond('create', {Key: key})
        if (command instanceof DeleteKeyCommand) return respond('delete', {Key: key})
        if (command instanceof ListAliasesCommand) return respond('listAliases', {Aliases: []})
        if (command instanceof GetAliasCommand) return respond('getAlias', {Alias: alias})
        if (command instanceof CreateAliasCommand) return respond('createAlias', {Alias: alias})
        if (command instanceof DeleteAliasCommand) return respond('deleteAlias', {})
        if (command instanceof GetPublicKeyCertificateCommand) {
            return respond('certificate', {KeyCertificate: 'CERTIFICATE-PEM'})
        }
        if (command instanceof ListTagsForResourceCommand) return respond('tags', {Tags: []})
        if (command instanceof TagResourceCommand) return respond('tag', {})
        if (command instanceof UntagResourceCommand) return respond('untag', {})
        return {}
    })
}

function notFound(): never {
    throw Object.assign(new Error('The key was not found.'), {
        name: 'ResourceNotFoundException',
        $metadata: {httpStatusCode: 400},
    })
}

/** The modes a key encryption key allows, the reference's Encrypt+Wrap combination. */
const ENCRYPT_AND_WRAP = {modeEncrypt: 'true', modeWrap: 'true'}

describe('AwsPaymentCryptographyAdapter', () => {
    test('identifies itself as the AWS payment cryptography adapter', () => {
        const adapter = new AwsPaymentCryptographyAdapter(runtimeStub().client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('paymentcryptography')
        expect(adapter.schema().cloud).toBe('aws')
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('the form opens on the values the adapter falls back to', () => {
        const schema = new AwsPaymentCryptographyAdapter(runtimeStub().client).schema()
        const usage = schema.fields.find((field) => field.name === 'keyUsage')
        const algorithm = schema.fields.find((field) => field.name === 'keyAlgorithm')
        const exportable = schema.fields.find((field) => field.name === 'exportable')
        const enabled = schema.fields.find((field) => field.name === 'enabled')

        // A select the form leaves on its default entry would show "Default" and
        // save something the page never showed, so the usage names its value. The
        // algorithm cannot: the one it saves depends on the usage, so it is left
        // unset and the adapter chooses it from the usage's own table.
        expect(usage?.defaultValue).toBe('TR31_B0_BASE_DERIVATION_KEY')
        expect(algorithm?.defaultValue).toBeUndefined()
        expect(exportable?.defaultValue).toBe('false')
        expect(enabled?.defaultValue).toBe('true')
    })

    describe('list', () => {
        test('returns the empty list when the account has no keys', async () => {
            const {client} = runtimeStub({list: {Keys: []}})

            expect(await new AwsPaymentCryptographyAdapter(client).list()).toEqual([])
        })

        test('maps a key onto the table columns', async () => {
            const {client, sent} = runtimeStub()

            const [row] = await new AwsPaymentCryptographyAdapter(client).list()

            // The keys and the aliases are read in parallel, so the list is one
            // ListKeys, one ListAliases and a GetKey for the key.
            expect(sent.filter((command) => command instanceof ListKeysCommand)).toHaveLength(1)
            expect(sent.filter((command) => command instanceof ListAliasesCommand)).toHaveLength(1)
            expect(row).toMatchObject({
                id: KEY_ID,
                name: ARN,
                cloud: 'aws',
                service: 'paymentcryptography',
                type: 'key',
                region: 'us-east-1',
                status: 'CREATE_COMPLETE',
                createdAt: '2026-11-04T09:15:00.000Z',
            })
            expect(row?.metadata).toMatchObject({
                keyClass: 'SYMMETRIC_KEY',
                keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY',
                keyAlgorithm: 'AES_256',
                keyCheckValue: '3F2A1B',
                enabled: true,
                exportable: false,
            })
        })

        test('follows NextToken so a long account is not truncated', async () => {
            const pages = [
                {Keys: [key], NextToken: 'page-2'},
                {Keys: [{...key, KeyArn: OTHER_ARN}]},
            ]
            const {client, sent} = stubClient((command) => {
                if (command instanceof ListKeysCommand) return pages.shift() ?? {}
                if (command instanceof GetKeyCommand) {
                    const arn = (command as GetKeyCommand).input.KeyIdentifier
                    return {Key: {...key, KeyArn: arn}}
                }
                return {}
            })

            const rows = await new AwsPaymentCryptographyAdapter(client).list()

            expect(rows.map((row) => row.id)).toEqual([KEY_ID, OTHER_KEY_ID])
            const listCalls = sent.filter((command) => command instanceof ListKeysCommand)
            expect((listCalls[1] as ListKeysCommand).input.NextToken).toBe('page-2')
        })

        test('searches the ARN and the usage', async () => {
            const pinKey = {
                ...key,
                KeyArn: OTHER_ARN,
                KeyAttributes: {...attributes, KeyUsage: 'TR31_P0_PIN_ENCRYPTION_KEY'},
            }
            const {client} = stubClient((command) => {
                if (command instanceof ListKeysCommand) return {Keys: [key, pinKey]}
                if (command instanceof GetKeyCommand) {
                    const arn = (command as GetKeyCommand).input.KeyIdentifier
                    return {Key: arn === OTHER_ARN ? pinKey : key}
                }
                return {}
            })
            const adapter = new AwsPaymentCryptographyAdapter(client)

            expect((await adapter.list({search: 'K0_KEY'})).map((row) => row.id)).toEqual([KEY_ID])
            expect((await adapter.list({search: 'pin_encryption'})).map((row) => row.id)).toEqual([OTHER_KEY_ID])
            expect((await adapter.list({search: '4a1b2c3d'})).map((row) => row.id)).toEqual([KEY_ID])
            expect(await adapter.list({search: 'nothing'})).toEqual([])
        })
    })

    describe('get', () => {
        test('reads the certificate of an asymmetric key', async () => {
            const {client, sent} = runtimeStub({
                get: {Key: {...key, KeyAttributes: {...attributes, KeyClass: 'ASYMMETRIC_KEY_PAIR'}}},
            })

            const resource = await new AwsPaymentCryptographyAdapter(client).get(KEY_ID)

            expect(resource?.metadata.publicKeyCertificate).toBe('CERTIFICATE-PEM')
            expect(sent.some((command) => command instanceof GetPublicKeyCertificateCommand)).toBe(true)
        })

        test('does not ask a symmetric key for a certificate, which it has none of', async () => {
            const {client, sent} = runtimeStub()

            const resource = await new AwsPaymentCryptographyAdapter(client).get(KEY_ID)

            // A symmetric key has no public half, so the service is not asked
            // and the state says why there is no certificate.
            expect(resource?.metadata.publicKeyCertificate).toBeUndefined()
            expect(resource?.metadata.publicKeyCertificateState).toBe('no-public-half')
            expect(sent.some((command) => command instanceof GetPublicKeyCertificateCommand)).toBe(false)
        })

        test('shows the attributes, the check value and the tags the inspector needs', async () => {
            const {client} = runtimeStub({tags: {Tags: [{Key: 'env', Value: 'prod'}]}})

            const resource = await new AwsPaymentCryptographyAdapter(client).get(KEY_ID)

            expect(resource?.metadata).toMatchObject({
                keyModesOfUse: expect.objectContaining({Encrypt: true, DeriveKey: false}),
                keyCheckValueAlgorithm: 'CMAC',
                keyOrigin: 'AWS_PAYMENT_CRYPTOGRAPHY',
                tags: [{key: 'env', value: 'prod'}],
            })
        })

        test('returns null for a key that does not exist', async () => {
            const {client} = runtimeStub({get: notFound})

            expect(await new AwsPaymentCryptographyAdapter(client).get(KEY_ID)).toBeNull()
        })

        test('does not hide a real failure behind null', async () => {
            const {client} = stubClient(() => {
                throw Object.assign(new Error('boom'), {name: 'ServiceUnavailableException', $metadata: {httpStatusCode: 503}})
            })

            await expect(new AwsPaymentCryptographyAdapter(client).get(KEY_ID)).rejects.toThrow('boom')
        })

        test('keeps the key when the tag lookup fails, and says the tags are unknown', async () => {
            const {client} = runtimeStub({
                tags: () => {
                    throw new Error('throttled')
                },
            })

            const resource = await new AwsPaymentCryptographyAdapter(client).get(KEY_ID)

            expect(resource?.name).toBe(ARN)
            expect(resource?.metadata.tags).toEqual([])
            expect(resource?.metadata.tagsUnavailable).toBe(true)
        })
    })

    describe('create', () => {
        test('sends the usage, the algorithm, the class and the modes of use', async () => {
            const {client, sent} = runtimeStub()

            const created = await new AwsPaymentCryptographyAdapter(client).create({
                values: {
                    keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY',
                    keyAlgorithm: 'AES_256',
                    exportable: 'true',
                    enabled: 'true',
                    modeEncrypt: 'true',
                    modeDecrypt: 'true',
                    modeWrap: 'true',
                    modeUnwrap: 'true',
                },
            })

            const request = sent.find((command) => command instanceof CreateKeyCommand) as CreateKeyCommand
            expect(request.input.KeyAttributes).toEqual({
                KeyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY',
                KeyAlgorithm: 'AES_256',
                KeyClass: 'SYMMETRIC_KEY',
                KeyModesOfUse: {Encrypt: true, Decrypt: true, Wrap: true, Unwrap: true},
            })
            expect(request.input.Exportable).toBe(true)
            expect(request.input.Enabled).toBe(true)
            expect(created.id).toBe(KEY_ID)
        })

        test('makes an asymmetric key a key pair', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).create({
                values: {
                    keyUsage: 'TR31_K2_TR34_ASYMMETRIC_KEY',
                    keyAlgorithm: 'RSA_2048',
                    modeDeriveKey: 'true',
                },
            })

            const request = sent.find((command) => command instanceof CreateKeyCommand) as CreateKeyCommand
            expect(request.input.KeyAttributes?.KeyClass).toBe('ASYMMETRIC_KEY_PAIR')
        })

        test('leaves the modes the form did not offer out of the request', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).create({
                values: {keyUsage: 'TR31_P0_PIN_ENCRYPTION_KEY', keyAlgorithm: 'TDES_2KEY', ...ENCRYPT_AND_WRAP},
            })

            const request = sent.find((command) => command instanceof CreateKeyCommand) as CreateKeyCommand
            expect(request.input.KeyAttributes?.KeyModesOfUse).toEqual({Encrypt: true, Wrap: true})
        })

        test('defaults a key to enabled and not exportable', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).create({
                values: {keyUsage: 'TR31_P0_PIN_ENCRYPTION_KEY', ...ENCRYPT_AND_WRAP},
            })

            const request = sent.find((command) => command instanceof CreateKeyCommand) as CreateKeyCommand
            expect(request.input.Exportable).toBe(false)
            expect(request.input.Enabled).toBe(true)
        })

        test('takes the usage and the algorithm the form opens on when they are left unset', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).create({values: {modeDeriveKey: 'true'}})

            const request = sent.find((command) => command instanceof CreateKeyCommand) as CreateKeyCommand
            expect(request.input.KeyAttributes?.KeyUsage).toBe('TR31_B0_BASE_DERIVATION_KEY')
            expect(request.input.KeyAttributes?.KeyAlgorithm).toBe('TDES_2KEY')
        })

        test('takes the algorithm of the usage when the usage is an asymmetric one', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).create({
                values: {keyUsage: 'TR31_K3_ASYMMETRIC_KEY_FOR_KEY_AGREEMENT', modeDeriveKey: 'true'},
            })

            const request = sent.find((command) => command instanceof CreateKeyCommand) as CreateKeyCommand
            expect(request.input.KeyAttributes?.KeyAlgorithm).toBe('ECC_NIST_P256')
        })

        test('refuses an algorithm the usage does not allow, and names the ones it does', async () => {
            const {client, sent} = runtimeStub()
            const adapter = new AwsPaymentCryptographyAdapter(client)

            await expect(
                adapter.create({values: {keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY', keyAlgorithm: 'RSA_2048', ...ENCRYPT_AND_WRAP}}),
            ).rejects.toBeInstanceOf(ValidationError)
            await expect(
                adapter.create({values: {keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY', keyAlgorithm: 'RSA_2048', ...ENCRYPT_AND_WRAP}}),
            ).rejects.toThrow(/use one of TDES_2KEY, TDES_3KEY, AES_128, AES_192, AES_256/)
            await expect(
                adapter.create({values: {keyUsage: 'TR31_M1_ISO_9797_1_MAC_KEY', keyAlgorithm: 'AES_256', modeGenerate: 'true'}}),
            ).rejects.toThrow(/use one of TDES_2KEY, TDES_3KEY/)
            expect(sent).toHaveLength(0)
        })

        test('refuses an elliptic curve key for a usage that takes an RSA one', async () => {
            const {client, sent} = runtimeStub()
            const adapter = new AwsPaymentCryptographyAdapter(client)

            await expect(
                adapter.create({
                    values: {keyUsage: 'TR31_S0_ASYMMETRIC_KEY_FOR_DIGITAL_SIGNATURE', keyAlgorithm: 'ECC_NIST_P256', modeSign: 'true'},
                }),
            ).rejects.toThrow(/use one of RSA_2048, RSA_3072, RSA_4096/)
            expect(sent).toHaveLength(0)
        })

        test('refuses an RSA key for the key agreement usage, which takes an elliptic curve one', async () => {
            const {client, sent} = runtimeStub()
            const adapter = new AwsPaymentCryptographyAdapter(client)

            await expect(
                adapter.create({
                    values: {keyUsage: 'TR31_K3_ASYMMETRIC_KEY_FOR_KEY_AGREEMENT', keyAlgorithm: 'RSA_2048', modeDeriveKey: 'true'},
                }),
            ).rejects.toThrow(/use one of ECC_NIST_P256, ECC_NIST_P384, ECC_NIST_P521/)
            expect(sent).toHaveLength(0)
        })

        test('makes a hash key of the hash it carries', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).create({
                values: {
                    keyUsage: 'TR31_M7_HMAC_KEY',
                    keyAlgorithm: 'HMAC_SHA512',
                    modeGenerate: 'true',
                    modeVerify: 'true',
                },
            })

            const request = sent.find((command) => command instanceof CreateKeyCommand) as CreateKeyCommand
            expect(request.input.KeyAttributes?.KeyAlgorithm).toBe('HMAC_SHA512')
            expect(request.input.KeyAttributes?.KeyClass).toBe('SYMMETRIC_KEY')
        })

        test('refuses a combination of modes the usage does not allow, and names the ones it does', async () => {
            const {client, sent} = runtimeStub()
            const adapter = new AwsPaymentCryptographyAdapter(client)

            await expect(
                adapter.create({values: {keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY', modeEncrypt: 'true'}}),
            ).rejects.toBeInstanceOf(ValidationError)
            await expect(
                adapter.create({values: {keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY', modeEncrypt: 'true'}}),
            ).rejects.toThrow(
                /use one of Encrypt\+Decrypt\+Wrap\+Unwrap, Encrypt\+Wrap, Decrypt\+Unwrap, NoRestrictions/,
            )
            // A MAC key may not encrypt.
            await expect(
                adapter.create({values: {keyUsage: 'TR31_M1_ISO_9797_1_MAC_KEY', modeEncrypt: 'true'}}),
            ).rejects.toThrow(/use one of Generate, Verify, Generate\+Verify, NoRestrictions/)
            expect(sent).toHaveLength(0)
        })

        test('refuses a key with no mode of use, because it would do no work', async () => {
            const {client, sent} = runtimeStub()
            const adapter = new AwsPaymentCryptographyAdapter(client)

            await expect(
                adapter.create({values: {keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY', modeEncrypt: 'false'}}),
            ).rejects.toBeInstanceOf(ValidationError)
            expect(sent).toHaveLength(0)
        })

        test('refuses a mode that is neither of the two answers', async () => {
            const {client, sent} = runtimeStub()
            const adapter = new AwsPaymentCryptographyAdapter(client)

            await expect(
                adapter.create({values: {keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY', modeEncrypt: 'TRUE'}}),
            ).rejects.toBeInstanceOf(ValidationError)
            expect(sent).toHaveLength(0)
        })

        test('refuses a usage the reference does not name', async () => {
            const {client, sent} = runtimeStub()

            await expect(
                new AwsPaymentCryptographyAdapter(client).create({values: {keyUsage: 'TR31_Z9_MADE_UP', modeEncrypt: 'true'}}),
            ).rejects.toBeInstanceOf(ValidationError)
            expect(sent).toHaveLength(0)
        })

        test('fails loudly when the service returns no key', async () => {
            const {client} = runtimeStub({create: {}})

            await expect(
                new AwsPaymentCryptographyAdapter(client).create({values: {keyUsage: 'TR31_K0_KEY_ENCRYPTION_KEY', ...ENCRYPT_AND_WRAP}}),
            ).rejects.toBeInstanceOf(RuntimeError)
        })
    })

    test('the health check reads one page rather than every key in the account', async () => {
        const {client, sent} = runtimeStub()

        await new AwsPaymentCryptographyAdapter(client).health()

        expect(sent).toHaveLength(1)
        expect((sent[0] as ListKeysCommand).input).toEqual({MaxResults: 1})
    })

    describe('aliases', () => {
        test('lists the aliases beside the keys', async () => {
            const {client} = runtimeStub({listAliases: {Aliases: [alias]}})

            const rows = await new AwsPaymentCryptographyAdapter(client).list()

            expect(rows.map((row) => row.id)).toEqual([KEY_ID, ALIAS_ID])
            expect(rows.find((row) => row.id === ALIAS_ID)?.metadata).toMatchObject({
                aliasName: ALIAS_NAME,
                targetKeyArn: ARN,
            })
        })

        test('the kind facet narrows the list to one kind', async () => {
            const {client} = runtimeStub({listAliases: {Aliases: [alias]}})
            const adapter = new AwsPaymentCryptographyAdapter(client)

            expect((await adapter.list({filters: {kind: 'aliases'}})).map((row) => row.id)).toEqual([ALIAS_ID])
            expect((await adapter.list({filters: {kind: 'keys'}})).map((row) => row.id)).toEqual([KEY_ID])
        })

        test('reads an alias, which lives in the region of the key it names', async () => {
            const {client} = runtimeStub()

            const resource = await new AwsPaymentCryptographyAdapter(client).get(ALIAS_ID)

            expect(resource?.name).toBe(ALIAS_NAME)
            expect(resource?.type).toBe('alias')
            expect(resource?.region).toBe('us-east-1')
        })

        test('makes an alias that points at a key', async () => {
            const {client, sent} = runtimeStub()

            const created = await new AwsPaymentCryptographyAdapter(client).create({
                values: {kind: 'aliases', aliasName: ALIAS_NAME, aliasTargetKey: KEY_ID},
            })

            const request = sent.find((command) => command instanceof CreateAliasCommand) as CreateAliasCommand
            expect(request.input).toEqual({AliasName: ALIAS_NAME, KeyArn: ARN})
            expect(created.id).toBe(ALIAS_ID)
        })

        test('takes the ARN of a key as well as the id the console knows it by', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).create({
                values: {kind: 'aliases', aliasName: ALIAS_NAME, aliasTargetKey: ARN},
            })

            const request = sent.find((command) => command instanceof CreateAliasCommand) as CreateAliasCommand
            expect(request.input.KeyArn).toBe(ARN)
        })

        test('refuses an alias name the reference does not allow', async () => {
            const {client, sent} = runtimeStub()

            await expect(
                new AwsPaymentCryptographyAdapter(client).create({
                    values: {kind: 'aliases', aliasName: 'ExampleAlias', aliasTargetKey: ARN},
                }),
            ).rejects.toBeInstanceOf(ValidationError)
            expect(sent).toHaveLength(0)
        })

        test('removes an alias at once', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).delete(ALIAS_ID)

            expect((sent[0] as DeleteAliasCommand).input).toEqual({AliasName: ALIAS_NAME})
        })

        test('keeps the prefix an alias name of its own carries', async () => {
            // The reference allows a name that begins with the prefix again, so
            // `alias/alias/foo` is one alias named `alias/foo`. Restoring the one
            // prefix parseId removed is what names it, not a guess from the text.
            const nestedName = 'alias/alias/foo'
            const nested = {AliasName: nestedName, KeyArn: ARN}
            const {client, sent} = runtimeStub({listAliases: {Aliases: [nested]}})
            const adapter = new AwsPaymentCryptographyAdapter(client)

            const rows = await adapter.list()
            expect(rows.map((row) => row.id)).toEqual([KEY_ID, nestedName])

            await adapter.get(nestedName)
            expect((sent.find((command) => command instanceof GetAliasCommand) as GetAliasCommand).input).toEqual({
                AliasName: nestedName,
            })

            await adapter.delete(nestedName)
            expect((sent.find((command) => command instanceof DeleteAliasCommand) as DeleteAliasCommand).input).toEqual({
                AliasName: nestedName,
            })
        })

        test('an alias carries no tags of its own', async () => {
            const {client} = runtimeStub()

            await expect(
                new AwsPaymentCryptographyAdapter(client).updateTags(ALIAS_ID, {env: 'prod'}),
            ).rejects.toBeInstanceOf(ValidationError)
        })

        test('a resource id that names no kind is refused', async () => {
            const {client} = runtimeStub()

            await expect(new AwsPaymentCryptographyAdapter(client).get(ARN)).rejects.toBeInstanceOf(ValidationError)
        })
    })

    test('schedules the deletion of a key by its ARN', async () => {
        const {client, sent} = runtimeStub()

        await new AwsPaymentCryptographyAdapter(client).delete(KEY_ID)

        expect((sent[0] as DeleteKeyCommand).input).toEqual({KeyIdentifier: ARN})
    })

    describe('updateTags', () => {
        test('adds and removes the tags it is given', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).updateTags(KEY_ID, {env: 'prod', owner: null})

            const added = sent.find((command) => command instanceof TagResourceCommand) as TagResourceCommand
            expect(added.input).toEqual({ResourceArn: ARN, Tags: [{Key: 'env', Value: 'prod'}]})
            const removed = sent.find((command) => command instanceof UntagResourceCommand) as UntagResourceCommand
            expect(removed.input).toEqual({ResourceArn: ARN, TagKeys: ['owner']})
        })

        test('sends nothing when there is nothing to change', async () => {
            const {client, sent} = runtimeStub()

            await new AwsPaymentCryptographyAdapter(client).updateTags(KEY_ID, {})

            expect(sent).toHaveLength(0)
        })
    })
})

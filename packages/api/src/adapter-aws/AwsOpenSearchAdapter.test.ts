import {describe, expect, test} from 'bun:test'
import {
    CreateDomainCommand,
    DeleteDomainCommand,
    DescribeDomainCommand,
    ListDomainNamesCommand,
    type OpenSearchClient,
} from '@aws-sdk/client-opensearch'
import {AwsOpenSearchAdapter} from './AwsOpenSearchAdapter'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

/** Minimal OpenSearchClient stub that records the commands it was sent. */
function stubOpenSearch(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as OpenSearchClient
    return {client, sent}
}

class NamedError extends Error {
    constructor(readonly name: string) {
        super(name)
    }
}

// Shape as Floci returns a domain.
const domain = {
    DomainId: '000000000000/orders',
    DomainName: 'orders',
    ARN: 'arn:aws:es:us-east-1:000000000000:domain/orders',
    Created: true,
    Deleted: false,
    Endpoint: 'search-orders-4407a3e4.us-east-1.es.amazonaws.com',
    Processing: false,
    EngineVersion: 'OpenSearch_2.11',
    ClusterConfig: {InstanceType: 't3.small.search', InstanceCount: 1, DedicatedMasterEnabled: false},
    EBSOptions: {EBSEnabled: true, VolumeType: 'gp2', VolumeSize: 10},
    AccessPolicies: '{"Version":"2012-10-17","Statement":[]}',
}

function describeHandler(domains: Record<string, SendResult>) {
    return (command: object): SendResult => {
        if (command instanceof ListDomainNamesCommand) {
            return {DomainNames: Object.keys(domains).map((DomainName) => ({DomainName, EngineType: 'OpenSearch'}))}
        }
        if (command instanceof DescribeDomainCommand) {
            const found = domains[command.input.DomainName as string]
            if (!found) throw new NamedError('ResourceNotFoundException')
            return {DomainStatus: found}
        }
        throw new Error(`unexpected command ${command.constructor.name}`)
    }
}

describe('AwsOpenSearchAdapter.list', () => {
    test('is empty when there are no domains', async () => {
        const {client} = stubOpenSearch(describeHandler({}))

        expect(await new AwsOpenSearchAdapter(client).list()).toEqual([])
    })

    test('lists every domain with engine, version, instance type and endpoint', async () => {
        const {client} = stubOpenSearch(describeHandler({orders: domain}))

        const [resource] = await new AwsOpenSearchAdapter(client).list()

        expect(resource).toMatchObject({
            id: 'orders',
            name: 'orders',
            cloud: 'aws',
            service: 'search',
            type: 'domain',
            region: 'us-east-1',
            status: 'Active',
            engine: 'OpenSearch',
            version: '2.11',
            instanceClass: 't3.small.search',
        })
        expect(resource.metadata.endpoint).toBe('search-orders-4407a3e4.us-east-1.es.amazonaws.com')
    })

    test('describes each listed domain by name', async () => {
        const {client, sent} = stubOpenSearch(describeHandler({orders: domain, logs: {...domain, DomainName: 'logs'}}))

        await new AwsOpenSearchAdapter(client).list()

        const described = sent.filter((command) => command instanceof DescribeDomainCommand)
            .map((command) => (command as DescribeDomainCommand).input.DomainName)
        expect(described.sort()).toEqual(['logs', 'orders'])
    })

    test('skips a domain deleted between the list and its description', async () => {
        const {client} = stubOpenSearch((command) => {
            if (command instanceof ListDomainNamesCommand) {
                return {DomainNames: [{DomainName: 'orders'}, {DomainName: 'gone'}]}
            }
            if ((command as DescribeDomainCommand).input.DomainName === 'gone') throw new NamedError('ResourceNotFoundException')
            return {DomainStatus: domain}
        })

        const resources = await new AwsOpenSearchAdapter(client).list()

        expect(resources.map((resource) => resource.name)).toEqual(['orders'])
    })

    test('searches by name and by engine version', async () => {
        const {client} = stubOpenSearch(describeHandler({
            orders: domain,
            logs: {...domain, DomainName: 'logs', EngineVersion: 'Elasticsearch_7.10'},
        }))
        const adapter = new AwsOpenSearchAdapter(client)

        expect((await adapter.list({search: 'ORD'})).map((resource) => resource.name)).toEqual(['orders'])
        expect((await adapter.list({search: 'elasticsearch'})).map((resource) => resource.name)).toEqual(['logs'])
    })
})

describe('AwsOpenSearchAdapter state', () => {
    async function stateOf(overrides: SendResult) {
        const {client} = stubOpenSearch(describeHandler({orders: {...domain, ...overrides}}))
        return (await new AwsOpenSearchAdapter(client).get('orders'))?.status
    }

    test('shows a domain that is still starting as Creating', async () => {
        expect(await stateOf({Created: false, Processing: true, Endpoint: undefined})).toBe('Creating')
    })

    test('shows a domain applying a change as Processing', async () => {
        expect(await stateOf({Processing: true})).toBe('Processing')
    })

    test('shows a version upgrade as Upgrading', async () => {
        expect(await stateOf({UpgradeProcessing: true})).toBe('Upgrading')
    })

    test('shows a deleted domain as Deleting', async () => {
        expect(await stateOf({Deleted: true})).toBe('Deleting')
    })

    test('prefers DomainProcessingStatus when the runtime reports it', async () => {
        expect(await stateOf({DomainProcessingStatus: 'Modifying', Processing: false})).toBe('Modifying')
    })
})

describe('AwsOpenSearchAdapter.get', () => {
    test('returns cluster config, storage options and the access policy as a document', async () => {
        const {client} = stubOpenSearch(describeHandler({orders: domain}))

        const resource = await new AwsOpenSearchAdapter(client).get('orders')

        expect(resource?.metadata.arn).toBe('arn:aws:es:us-east-1:000000000000:domain/orders')
        expect(resource?.metadata.clusterConfig).toEqual(domain.ClusterConfig)
        expect(resource?.metadata.ebsOptions).toEqual(domain.EBSOptions)
        expect(resource?.metadata.accessPolicies).toEqual({Version: '2012-10-17', Statement: []})
    })

    test('keeps an access policy that is not valid JSON as text', async () => {
        const {client} = stubOpenSearch(describeHandler({orders: {...domain, AccessPolicies: 'not json'}}))

        expect((await new AwsOpenSearchAdapter(client).get('orders'))?.metadata.accessPolicies).toBe('not json')
    })

    test('uses the VPC address when the domain has no public endpoint', async () => {
        const {client} = stubOpenSearch(describeHandler({
            orders: {...domain, Endpoint: undefined, Endpoints: {vpc: 'vpc-orders-abc.us-east-1.es.amazonaws.com'}},
        }))

        expect((await new AwsOpenSearchAdapter(client).get('orders'))?.metadata.endpoint)
            .toBe('vpc-orders-abc.us-east-1.es.amazonaws.com')
    })

    test('returns null for an unknown domain', async () => {
        const {client} = stubOpenSearch(describeHandler({}))

        expect(await new AwsOpenSearchAdapter(client).get('missing')).toBeNull()
    })

    test('rethrows an error that is not a missing domain', async () => {
        const {client} = stubOpenSearch(() => {
            throw new NamedError('AccessDeniedException')
        })

        await expect(new AwsOpenSearchAdapter(client).get('orders')).rejects.toThrow('AccessDeniedException')
    })
})

describe('AwsOpenSearchAdapter.create', () => {
    function creating() {
        return stubOpenSearch((command) => {
            if (command instanceof CreateDomainCommand) return {DomainStatus: domain}
            return describeHandler({orders: domain})(command)
        })
    }

    test('sends only the name when nothing else is given, so the runtime picks its defaults', async () => {
        const {client, sent} = creating()

        await new AwsOpenSearchAdapter(client).create({values: {name: 'orders'}})

        expect((sent[0] as CreateDomainCommand).input).toEqual({DomainName: 'orders'})
    })

    test('sends the engine version, instance type and storage size', async () => {
        const {client, sent} = creating()

        const resource = await new AwsOpenSearchAdapter(client).create({
            values: {name: ' orders ', engineVersion: 'OpenSearch_2.11', instanceType: 't3.small.search', volumeSize: '10'},
        })

        expect((sent[0] as CreateDomainCommand).input).toEqual({
            DomainName: 'orders',
            EngineVersion: 'OpenSearch_2.11',
            ClusterConfig: {InstanceType: 't3.small.search'},
            EBSOptions: {EBSEnabled: true, VolumeSize: 10},
        })
        expect(resource.id).toBe('orders')
    })

    test('rejects a missing, short, long or badly shaped name without calling the runtime', async () => {
        const {client, sent} = creating()
        const adapter = new AwsOpenSearchAdapter(client)

        for (const name of ['', 'ab', 'a'.repeat(29), 'Orders', '1orders', 'my_domain']) {
            await expect(adapter.create({values: {name}})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(sent).toEqual([])
    })

    test('rejects a storage size that is not a whole number', async () => {
        const {client} = creating()
        const adapter = new AwsOpenSearchAdapter(client)

        for (const volumeSize of ['abc', '0', '1.5', '-3']) {
            await expect(adapter.create({values: {name: 'orders', volumeSize}})).rejects.toBeInstanceOf(ValidationError)
        }
    })

    test('fails when the runtime does not return the domain it just created', async () => {
        const {client} = stubOpenSearch((command) => {
            if (command instanceof CreateDomainCommand) return {DomainStatus: domain}
            return describeHandler({})(command)
        })

        await expect(new AwsOpenSearchAdapter(client).create({values: {name: 'orders'}}))
            .rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('AwsOpenSearchAdapter.delete and health', () => {
    test('deletes by domain name', async () => {
        const {client, sent} = stubOpenSearch(() => ({DomainStatus: {...domain, Deleted: true}}))

        await new AwsOpenSearchAdapter(client).delete('orders')

        expect(sent[0]).toBeInstanceOf(DeleteDomainCommand)
        expect((sent[0] as DeleteDomainCommand).input).toEqual({DomainName: 'orders'})
    })

    test('health lists domain names', async () => {
        const {client, sent} = stubOpenSearch(() => ({DomainNames: []}))

        await new AwsOpenSearchAdapter(client).health()

        expect(sent[0]).toBeInstanceOf(ListDomainNamesCommand)
    })
})

describe('AwsOpenSearchAdapter.schema', () => {
    test('advertises exactly what the adapter performs', () => {
        const schema = new AwsOpenSearchAdapter({} as OpenSearchClient).schema()

        expect(schema.service).toBe('search')
        expect(schema.actions).toEqual(['list', 'create', 'inspect', 'delete'])
        expect(schema.columns.map((column) => column.name)).toEqual(
            ['name', 'status', 'engine', 'version', 'instanceClass', 'endpoint'])
    })
})

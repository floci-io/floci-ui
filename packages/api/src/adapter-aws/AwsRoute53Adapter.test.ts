import {describe, expect, test} from 'bun:test'
import {
    ChangeResourceRecordSetsCommand,
    CreateHostedZoneCommand,
    DeleteHostedZoneCommand,
    GetHostedZoneCommand,
    ListHostedZonesCommand,
    ListResourceRecordSetsCommand,
    type HostedZone,
    type Route53Client,
} from '@aws-sdk/client-route-53'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {AwsRoute53Adapter} from './AwsRoute53Adapter'

type SendHandler = (command: unknown) => Promise<unknown>

function zone(id: string, name = `${id}.example.com.`, extra: Partial<HostedZone> = {}): HostedZone {
    return {Id: `/hostedzone/${id}`, Name: name, CallerReference: `ref-${id}`, ResourceRecordSetCount: 2, ...extra}
}

function createAdapter(handler: SendHandler = async () => ({})): AwsRoute53Adapter {
    return new AwsRoute53Adapter({send: handler} as unknown as Route53Client)
}

describe('AwsRoute53Adapter', () => {
    test('identifies Route 53 as the AWS dns adapter', () => {
        const adapter = createAdapter()

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('dns')
        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'dns', displayName: 'Route 53 Hosted Zones'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('follows NextMarker across pages', async () => {
        const markers: Array<string | undefined> = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListHostedZonesCommand) {
                markers.push(command.input.Marker)
                return command.input.Marker
                    ? {HostedZones: [zone('Z2')], IsTruncated: false}
                    : {HostedZones: [zone('Z1')], IsTruncated: true, NextMarker: 'page-2'}
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resources = await adapter.list()

        expect(resources.map((resource) => resource.id)).toEqual(['Z1', 'Z2'])
        expect(markers).toEqual([undefined, 'page-2'])
    })

    test('rejects a repeated ListHostedZones marker', async () => {
        const adapter = createAdapter(async () => ({HostedZones: [zone('Z1')], IsTruncated: true, NextMarker: 'again'}))

        await expect(adapter.list()).rejects.toThrow('Route 53 ListHostedZones repeated a marker')
    })

    test('maps a public zone to the shared resource shape and drops the id prefix', async () => {
        const adapter = createAdapter(async () => ({
            HostedZones: [zone('Z1', 'example.com.', {Config: {Comment: 'main', PrivateZone: false}})],
            IsTruncated: false,
        }))

        const [resource] = await adapter.list()

        expect(resource).toEqual({
            id: 'Z1',
            name: 'example.com.',
            cloud: 'aws',
            service: 'dns',
            type: 'route53-hosted-zone',
            region: null,
            createdAt: null,
            status: null,
            metadata: {
                provider: 'aws',
                arn: 'arn:aws:route53:::hostedzone/Z1',
                zoneType: 'Public',
                privateZone: false,
                recordCount: 2,
                comment: 'main',
                callerReference: 'ref-Z1',
                vpcs: null,
                nameServers: null,
            },
        })
    })

    test('inspect carries VPCs and name servers and labels a private zone', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof GetHostedZoneCommand) {
                return {
                    HostedZone: zone('Z1', 'internal.example.com.', {Config: {PrivateZone: true}}),
                    VPCs: [{VPCId: 'vpc-0123', VPCRegion: 'us-east-1'}],
                    DelegationSet: {NameServers: ['ns-1.awsdns-01.org']},
                }
            }
            return {}
        })

        const resource = await adapter.get('Z1')

        expect(resource?.metadata).toMatchObject({
            zoneType: 'Private',
            vpcs: [{vpcId: 'vpc-0123', vpcRegion: 'us-east-1'}],
            nameServers: ['ns-1.awsdns-01.org'],
        })
    })

    test('searches id, name and comment', async () => {
        const adapter = createAdapter(async () => ({
            HostedZones: [
                zone('ZAAA', 'alpha.example.com.'),
                zone('ZBBB', 'beta.example.com.', {Config: {Comment: 'Shared Staging'}}),
            ],
            IsTruncated: false,
        }))

        expect((await adapter.list({search: 'ALPHA'})).map((r) => r.id)).toEqual(['ZAAA'])
        expect((await adapter.list({search: 'staging'})).map((r) => r.id)).toEqual(['ZBBB'])
        expect((await adapter.list({search: 'zbbb'})).map((r) => r.id)).toEqual(['ZBBB'])
    })

    test('creates a public zone with a fresh caller reference', async () => {
        const sent: CreateHostedZoneCommand[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command as CreateHostedZoneCommand)
            return {HostedZone: zone('Z9', 'example.com.')}
        })

        const created = await adapter.create({values: {name: ' example.com ', comment: ' main '}})

        expect(created.id).toBe('Z9')
        expect(sent[0].input.Name).toBe('example.com')
        expect(sent[0].input.HostedZoneConfig).toEqual({Comment: 'main'})
        expect(sent[0].input.VPC).toBeUndefined()
        expect(sent[0].input.CallerReference).toMatch(/^[0-9a-f-]{36}$/)
    })

    test('creates a private zone when both VPC fields are set', async () => {
        const sent: CreateHostedZoneCommand[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command as CreateHostedZoneCommand)
            return {
                HostedZone: zone('Z9', 'internal.example.com.', {Config: {PrivateZone: true}}),
                VPC: {VPCId: 'vpc-0123', VPCRegion: 'us-east-1'},
            }
        })

        const created = await adapter.create({
            values: {name: 'internal.example.com', vpcId: 'vpc-0123', vpcRegion: 'us-east-1'},
        })

        expect(sent[0].input.VPC).toEqual({VPCId: 'vpc-0123', VPCRegion: 'us-east-1'})
        expect(sent[0].input.HostedZoneConfig).toEqual({PrivateZone: true})
        expect(created.metadata).toMatchObject({zoneType: 'Private', vpcs: [{vpcId: 'vpc-0123', vpcRegion: 'us-east-1'}]})
    })

    test('rejects malformed input before any request', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        const bad: Array<Record<string, unknown>> = [
            {},
            {name: ''},
            {name: 'has space.com'},
            {name: 'https://example.com'},
            {name: `${'a'.repeat(254)}`},
            {name: 'example.com', comment: 'x'.repeat(257)},
            {name: 'example.com', vpcId: 'vpc-0123'},
            {name: 'example.com', vpcRegion: 'us-east-1'},
            {name: 'example.com', vpcId: 'subnet-1', vpcRegion: 'us-east-1'},
            {name: 'example.com', vpcId: 'vpc-0123', vpcRegion: 'Virginia'},
        ]
        for (const values of bad) {
            await expect(adapter.create({values})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(sent).toEqual([])
    })

    test('deletes by zone id', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        await adapter.delete('Z1')

        expect(sent[0]).toBeInstanceOf(DeleteHostedZoneCommand)
        expect((sent[0] as DeleteHostedZoneCommand).input.Id).toBe('Z1')
    })

    test('health lists a single zone', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {HostedZones: []}
        })

        await adapter.health()

        expect(sent).toHaveLength(1)
        expect((sent[0] as ListHostedZonesCommand).input.MaxItems).toBe(1)
    })
})

describe('AwsRoute53Adapter record sets', () => {
    test('exposes one fixed records collection with the zone record count', async () => {
        const adapter = createAdapter(async () => ({HostedZone: zone('Z1', 'example.com.', {ResourceRecordSetCount: 5})}))

        const page = await adapter.documents.listCollections('Z1')

        expect(page).toEqual({
            items: [{id: 'records', name: 'Record sets', parentId: 'Z1', createdAt: null, metadata: {recordCount: 5}}],
            nextCursor: null,
        })
    })

    test('an unknown collection id is not found', async () => {
        const adapter = createAdapter()

        await expect(adapter.documents.listItems('Z1', 'health-checks')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('lists record sets, maps values and passes the cursor through', async () => {
        const inputs: ListResourceRecordSetsCommand['input'][] = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListResourceRecordSetsCommand) {
                inputs.push(command.input)
                return command.input.StartRecordName
                    ? {ResourceRecordSets: [{Name: 'z.example.com.', Type: 'TXT', TTL: 60, ResourceRecords: [{Value: '"v=1"'}]}], IsTruncated: false}
                    : {
                        ResourceRecordSets: [
                            {Name: 'example.com.', Type: 'SOA', TTL: 900, ResourceRecords: [{Value: 'ns-1 hostmaster 1 7200 900 1209600 86400'}]},
                            {Name: 'w.example.com.', Type: 'A', SetIdentifier: 'blue', AliasTarget: {DNSName: 'lb.example.com.', HostedZoneId: 'Z3', EvaluateTargetHealth: false}},
                        ],
                        IsTruncated: true,
                        NextRecordName: 'z.example.com.',
                        NextRecordType: 'TXT',
                    }
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const first = await adapter.documents.listItems('Z1', 'records', {limit: 1000})
        const second = await adapter.documents.listItems('Z1', 'records', {cursor: first.nextCursor ?? undefined})

        expect(inputs[0]).toMatchObject({HostedZoneId: 'Z1', MaxItems: 300})
        expect(first.items.map((item) => item.id)).toEqual(['SOA|example.com.', 'A|w.example.com.|blue'])
        expect(first.items[1].body).toMatchObject({
            ttl: null,
            values: [],
            aliasTarget: {dnsName: 'lb.example.com.', hostedZoneId: 'Z3', evaluateTargetHealth: false},
            setIdentifier: 'blue',
        })
        expect(inputs[1]).toMatchObject({StartRecordName: 'z.example.com.', StartRecordType: 'TXT'})
        expect(second.items[0].body).toMatchObject({type: 'TXT', ttl: 60, values: ['"v=1"']})
        expect(second.nextCursor).toBeNull()
    })

    test('rejects a cursor that is not ours', async () => {
        const adapter = createAdapter()

        await expect(adapter.documents.listItems('Z1', 'records', {cursor: 'not-a-cursor'})).rejects.toBeInstanceOf(
            ValidationError,
        )
    })

    test('upserts a simple record and reports the change', async () => {
        const sent: ChangeResourceRecordSetsCommand[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command as ChangeResourceRecordSetsCommand)
            return {ChangeInfo: {Id: '/change/C1', Status: 'INSYNC'}}
        })

        const item = await adapter.documents.putItem!('Z1', 'records', {
            name: 'www.example.com',
            type: 'a',
            ttl: '60',
            values: '1.2.3.4\n5.6.7.8',
        })

        expect(sent[0].input.ChangeBatch?.Changes).toEqual([
            {
                Action: 'UPSERT',
                ResourceRecordSet: {
                    Name: 'www.example.com',
                    Type: 'A',
                    TTL: 60,
                    ResourceRecords: [{Value: '1.2.3.4'}, {Value: '5.6.7.8'}],
                },
            },
        ])
        expect(item.id).toBe('A|www.example.com.')
        expect(item.body).toMatchObject({values: ['1.2.3.4', '5.6.7.8'], changeId: '/change/C1', changeStatus: 'INSYNC'})
    })

    test('defaults the TTL and keeps commas inside a TXT value', async () => {
        const sent: ChangeResourceRecordSetsCommand[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command as ChangeResourceRecordSetsCommand)
            return {}
        })

        await adapter.documents.putItem!('Z1', 'records', {name: 't.example.com', type: 'TXT', values: ['"a, b"']})

        expect(sent[0].input.ChangeBatch?.Changes?.[0].ResourceRecordSet).toMatchObject({
            TTL: 300,
            ResourceRecords: [{Value: '"a, b"'}],
        })
    })

    test('rejects malformed record bodies before any request', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        const bad: Array<Record<string, unknown>> = [
            {},
            {name: 'a.example.com', type: 'A'},
            {name: 'a.example.com', type: 'SOA', values: ['x']},
            {name: 'a.example.com', type: 'A', values: ['1.1.1.1'], ttl: -1},
            {name: 'a.example.com', type: 'A', values: ['1.1.1.1'], ttl: 'soon'},
            {name: '', type: 'A', values: ['1.1.1.1']},
            // routed and alias records are listed, not written: dropping the field would save a different record
            {name: 'a.example.com', type: 'A', values: ['1.1.1.1'], setIdentifier: 'blue', weight: 10},
            {name: 'a.example.com', type: 'A', values: ['1.1.1.1'], aliasTarget: {dnsName: 'lb.example.com'}},
        ]
        for (const body of bad) {
            await expect(adapter.documents.putItem!('Z1', 'records', body)).rejects.toBeInstanceOf(ValidationError)
        }
        expect(sent).toEqual([])
    })

    test('deletes a record by looking up its exact values first', async () => {
        const sent: unknown[] = []
        const stored = {Name: 'www.example.com.', Type: 'A' as const, TTL: 60, ResourceRecords: [{Value: '1.2.3.4'}]}
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            if (command instanceof ListResourceRecordSetsCommand) return {ResourceRecordSets: [stored]}
            return {}
        })

        await adapter.documents.deleteItem!('Z1', 'records', 'A|www.example.com')

        const lookup = sent[0] as ListResourceRecordSetsCommand
        expect(lookup.input).toMatchObject({StartRecordName: 'www.example.com', StartRecordType: 'A', MaxItems: 100})
        expect((sent[1] as ChangeResourceRecordSetsCommand).input.ChangeBatch?.Changes).toEqual([
            {Action: 'DELETE', ResourceRecordSet: stored},
        ])
    })

    test('a set identifier that contains a pipe deletes its own record, not a shorter one', async () => {
        const sent: unknown[] = []
        const blue = {Name: 'app.example.com.', Type: 'A' as const, SetIdentifier: 'blue', Weight: 1, TTL: 60}
        const blueGreen = {...blue, SetIdentifier: 'blue|green'}
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            if (command instanceof ListResourceRecordSetsCommand) return {ResourceRecordSets: [blue, blueGreen]}
            return {}
        })

        await adapter.documents.deleteItem!('Z1', 'records', 'A|app.example.com.|blue|green')

        const lookup = sent[0] as ListResourceRecordSetsCommand
        expect(lookup.input).toMatchObject({StartRecordIdentifier: 'blue|green'})
        expect((sent[1] as ChangeResourceRecordSetsCommand).input.ChangeBatch?.Changes).toEqual([
            {Action: 'DELETE', ResourceRecordSet: blueGreen},
        ])
    })

    test('deleting a record that is not there is not found, and nothing is changed', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {ResourceRecordSets: [{Name: 'zzz.example.com.', Type: 'A'}]}
        })

        await expect(adapter.documents.deleteItem!('Z1', 'records', 'A|www.example.com')).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(sent).toHaveLength(1)
    })

    test('a malformed record id is a validation error', async () => {
        const adapter = createAdapter()

        await expect(adapter.documents.deleteItem!('Z1', 'records', 'nonsense')).rejects.toBeInstanceOf(ValidationError)
    })
})

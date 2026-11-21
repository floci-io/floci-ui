import {afterEach, describe, expect, test} from 'bun:test'
import {OciGovernanceRulesAdapter} from './OciGovernanceRulesAdapter'
import {OciRestRuntimeClient} from '../oci'
import {NotFoundError, NotSupportedError, RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const CHILD = 'ocid1.tenancy.oc1..bhyagd5p62u3zpaqz5d3eumyd7evu3samsqbty2kmpiqsir2khzlhdrqpmfj'
const REGIONS = 'ocid1.governancerule.oc1..numm3xtwneznpw4tawg7dvnedg2cgiduservd64ehpb2mxfzrcjblezdcv56'
const QUOTA = 'ocid1.governancerule.oc1..5psdbovgqrzfymvtnfviqktk6dluaftl4oioag2fgvo6vbroc73k7hrbtqtc'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciGovernanceRulesAdapter {
    return new OciGovernanceRulesAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
}

function stubFetch(handler: (url: URL) => Response) {
    const calls: string[] = []
    globalThis.fetch = (async (url: string | URL | Request) => {
        calls.push(String(url))
        return handler(new URL(String(url)))
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

function notFound(): Response {
    return json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404})
}

// A summary leaves the template out; the full shape carries it.
const regionsSummary = {
    id: REGIONS,
    compartmentId: TENANCY,
    displayName: 'only-ashburn',
    type: 'ALLOWED_REGIONS',
    creationOption: 'TEMPLATE',
    timeCreated: '2026-11-20T22:32:14.337292210Z',
    timeUpdated: '2026-11-20T22:32:14.337292210Z',
    lifecycleState: 'ACTIVE',
}
const regionsFull = {
    ...regionsSummary,
    description: 'regions',
    template: {type: 'ALLOWED_REGIONS', displayName: 'only-ashburn', regions: ['us-ashburn-1']},
}
const quotaSummary = {...regionsSummary, id: QUOTA, displayName: 'cap', type: 'QUOTA', timeCreated: '2026-11-20T22:32:57.760381550Z'}

const criteria = [
    {id: 'ocid1.inclusioncriterion.oc1..all', governanceRuleId: REGIONS, type: 'ALL', lifecycleState: 'ACTIVE', timeCreated: '2026-11-20T22:32:57Z'},
    {
        id: 'ocid1.inclusioncriterion.oc1..one',
        governanceRuleId: REGIONS,
        type: 'TENANCY',
        association: {type: 'TENANCY', tenancyId: CHILD},
        lifecycleState: 'ACTIVE',
        timeCreated: '2026-11-20T22:33:00Z',
    },
]
const attachments = [
    {id: 'ocid1.tenancyattachment.oc1..a', compartmentId: TENANCY, governanceRuleId: REGIONS, tenancyId: CHILD, lifecycleState: 'ACTIVE', timeCreated: '2026-11-20T22:32:57Z'},
]

function populated(url: URL): Response {
    const path = url.pathname
    if (path === '/20220504/governanceRules') return json({items: [regionsSummary, quotaSummary]})
    if (path === `/20220504/governanceRules/${REGIONS}`) return json(regionsFull)
    if (path === `/20220504/governanceRules/${QUOTA}`) return json({...quotaSummary, template: {type: 'QUOTA', displayName: 'cap', statements: ['set x']}})
    if (path === '/20220504/inclusionCriteria') return json({items: criteria})
    if (path === '/20220504/tenancyAttachments') return json({items: attachments})
    return notFound()
}

describe('OciGovernanceRulesAdapter', () => {
    test('identifies itself and advertises only what it can do', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('governance')
        const schema = instance.schema()
        expect(schema.actions).toEqual(['list', 'inspect'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name)).toEqual(['list', 'inspect'])
        expect(schema.capabilities?.itemActions?.map((action) => action.name)).toEqual(['list'])
    })

    test('does not claim QUOTA or TAG rules are enforced', () => {
        const notice = adapter().schema().notice ?? ''
        expect(notice).toContain('ALLOWED_REGIONS')
        expect(notice).toContain('QUOTA and TAG')
        expect(notice).toContain('no effect')
    })

    test('lists the rules of the tenancy with type, state and creation time', async () => {
        const calls = stubFetch(populated)

        const rows = await adapter().list()

        expect(rows.map((row) => `${row.type}:${row.name}`)).toEqual(['ALLOWED_REGIONS:only-ashburn', 'QUOTA:cap'])
        expect(rows[0]).toMatchObject({
            id: REGIONS,
            status: 'ACTIVE',
            region: null,
            createdAt: '2026-11-20T22:32:14.337292210Z',
            metadata: {ocid: REGIONS, compartmentId: TENANCY, creationOption: 'TEMPLATE'},
        })
        expect(rows[0].metadata).not.toHaveProperty('template')
        expect(new URL(calls[0]).searchParams.get('compartmentId')).toBe(TENANCY)
    })

    test('is empty when the tenancy has no rule', async () => {
        stubFetch(() => json({items: []}))

        expect(await adapter().list()).toEqual([])
    })

    test('follows opc-next-page until a list runs out', async () => {
        const calls = stubFetch((url) => {
            if (url.searchParams.get('page') === 'p2') return json({items: [quotaSummary]})
            return new Response(JSON.stringify({items: [regionsSummary]}), {status: 200, headers: {'opc-next-page': 'p2'}})
        })

        const rows = await adapter().list()

        expect(rows.map((row) => row.name)).toEqual(['only-ashburn', 'cap'])
        expect(calls).toHaveLength(2)
    })

    test('stops when the runtime repeats a page token', async () => {
        const calls = stubFetch(() => new Response(JSON.stringify({items: [regionsSummary]}), {status: 200, headers: {'opc-next-page': 'same'}}))

        await adapter().list()

        expect(calls).toHaveLength(2)
    })

    test('searches by name, id and type', async () => {
        stubFetch(populated)

        expect((await adapter().list({search: 'only'})).map((row) => row.name)).toEqual(['only-ashburn'])
        expect((await adapter().list({search: QUOTA.toUpperCase()})).map((row) => row.name)).toEqual(['cap'])
        expect((await adapter().list({search: 'quota'})).map((row) => row.name)).toEqual(['cap'])
        expect(await adapter().list({search: 'nothing-matches'})).toEqual([])
    })

    test('fails the list when the runtime errors instead of returning a partial one', async () => {
        stubFetch(() => json({code: 'InternalServerError', message: 'boom'}, {status: 500}))

        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('inspects a rule with its template', async () => {
        stubFetch(populated)

        expect(await adapter().get(REGIONS)).toMatchObject({
            type: 'ALLOWED_REGIONS',
            name: 'only-ashburn',
            metadata: {description: 'regions', template: {regions: ['us-ashburn-1']}},
        })
    })

    test('returns null for a rule that is not there', async () => {
        stubFetch(populated)

        expect(await adapter().get('ocid1.governancerule.oc1..missing')).toBeNull()
    })

    test('rejects an id that is not a governance rule OCID', async () => {
        const calls = stubFetch(populated)

        for (const id of ['not-an-ocid', 'ocid1.bucket.oc1..x', 'ocid1.toString.oc1..x', 'ocid1.__proto__.oc1..x']) {
            await expect(adapter().get(id)).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toHaveLength(0)
    })

    test('lists the two fixed collections of a rule', async () => {
        stubFetch(populated)

        const page = await adapter().documents.listCollections(REGIONS)

        expect(page.items.map((item) => item.id)).toEqual(['inclusionCriteria', 'tenancyAttachments'])
        expect(page.items.every((item) => item.parentId === REGIONS)).toBe(true)
        expect(page.nextCursor).toBeNull()
    })

    test('a missing rule has no collections', async () => {
        stubFetch(populated)

        await expect(adapter().documents.listCollections('ocid1.governancerule.oc1..missing')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('lists the inclusion criteria of a rule', async () => {
        const calls = stubFetch(populated)

        const page = await adapter().documents.listItems(REGIONS, 'inclusionCriteria')

        expect(page.items.map((item) => item.body.type)).toEqual(['ALL', 'TENANCY'])
        expect(page.items[0].body).not.toHaveProperty('tenancyId')
        expect(page.items[1].body).toMatchObject({tenancyId: CHILD, lifecycleState: 'ACTIVE'})
        expect(calls.some((call) => new URL(call).pathname === '/20220504/inclusionCriteria'
            && new URL(call).searchParams.get('governanceRuleId') === REGIONS)).toBe(true)
    })

    test('lists the tenancy attachments of a rule', async () => {
        stubFetch(populated)

        const page = await adapter().documents.listItems(REGIONS, 'tenancyAttachments')

        expect(page.items).toHaveLength(1)
        expect(page.items[0]).toMatchObject({collectionId: 'tenancyAttachments', body: {tenancyId: CHILD, lifecycleState: 'ACTIVE'}})
    })

    test('pages a child collection with an offset cursor', async () => {
        stubFetch(populated)

        const first = await adapter().documents.listItems(REGIONS, 'inclusionCriteria', {limit: 1})
        expect(first.items).toHaveLength(1)
        expect(first.nextCursor).toBe('1')

        const second = await adapter().documents.listItems(REGIONS, 'inclusionCriteria', {limit: 1, cursor: first.nextCursor ?? undefined})
        expect(second.items.map((item) => item.body.type)).toEqual(['TENANCY'])
        expect(second.nextCursor).toBeNull()

        await expect(adapter().documents.listItems(REGIONS, 'inclusionCriteria', {cursor: 'x'})).rejects.toBeInstanceOf(ValidationError)
    })

    test('rejects a collection it does not know', async () => {
        const calls = stubFetch(populated)

        await expect(adapter().documents.listItems(REGIONS, 'subscriptions')).rejects.toBeInstanceOf(NotFoundError)
        expect(calls).toHaveLength(0)
    })

    test('does not create or delete records', async () => {
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(NotSupportedError)
        await expect(adapter().delete(REGIONS)).rejects.toBeInstanceOf(NotSupportedError)
    })
})

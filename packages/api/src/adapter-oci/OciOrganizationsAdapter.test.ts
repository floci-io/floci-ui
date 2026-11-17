import {afterEach, describe, expect, test} from 'bun:test'
import {OciOrganizationsAdapter} from './OciOrganizationsAdapter'
import {OciRestRuntimeClient} from '../oci'
import {NotSupportedError, RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const CHILD = 'ocid1.tenancy.oc1..fz4jkgvlknn6kccayezejmmgl5c7ykjssctu7qtex562g7qp56okm7cliefu'
const ORGANIZATION = 'ocid1.organization.oc1..dq4orstppllxmgjxufrawm3zv3ycy26d2bh672knhdipstoy226d3gog2x4c'
const LINK = 'ocid1.link.oc1..odwbwoq6yxdtxd3hcufvky7r57w5ttnytdgos3hbsuqgwwpljacigws5vpi3'
const SENT = 'ocid1.senderinvitation.oc1..usyts5cdcnvolopmzier4zzbu7cmjh6dyebig3hvn57zan7rqqvwh46la6hx'
const RECEIVED = 'ocid1.recipientinvitation.oc1..6jmkqvs2hj6ippwzc546hsblxkq7nkty3rxo6okqo47lfwyzyfkmgpqzahc6'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciOrganizationsAdapter {
    return new OciOrganizationsAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
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

const organization = {
    id: ORGANIZATION,
    compartmentId: TENANCY,
    defaultUcmSubscriptionId: 'ocid1.organizationssubscription.oc1.iad.fxwz3vmipei3v3rxrdw5jezleo4vaiyqirj2j7zga3wsnc43nlyhsttj5i62',
    lifecycleState: 'ACTIVE',
    timeCreated: '2026-11-17T20:16:54.826770179Z',
    displayName: 'floci-local',
    parentName: 'floci-local',
}

const child = {
    tenancyId: CHILD,
    governanceStatus: 'OPTED_IN',
    name: 'acme-dev',
    lifecycleState: 'ACTIVE',
    role: 'CHILD',
    timeJoined: '2026-11-17T20:16:54.826781804Z',
    isApprovedForTransfer: false,
}

const parent = {...child, tenancyId: TENANCY, name: 'floci-local', role: 'PARENT'}

const link = {
    id: LINK,
    parentTenancyId: TENANCY,
    childTenancyId: CHILD,
    timeCreated: '2026-11-17T20:16:54.826781804Z',
    lifecycleState: 'ACTIVE',
    feature: 'CORE',
}

const sentInvitation = {
    id: SENT,
    compartmentId: TENANCY,
    recipientInvitationId: RECEIVED,
    recipientTenancyId: 'ocid1.tenancy.oc1..otherrecipient',
    displayName: 'join us',
    subjects: ['LINK'],
    lifecycleState: 'ACTIVE',
    status: 'PENDING',
    timeCreated: '2026-11-17T20:18:58.558151305Z',
}

const receivedInvitation = {
    id: RECEIVED,
    compartmentId: TENANCY,
    senderInvitationId: 'ocid1.senderinvitation.oc1..elsewhere',
    senderTenancyId: 'ocid1.tenancy.oc1..sender',
    displayName: 'welcome',
    subjects: ['LINK'],
    lifecycleState: 'ACTIVE',
    status: 'PENDING',
    timeCreated: '2026-11-17T20:20:00Z',
}

function populated(url: URL): Response {
    const path = url.pathname
    if (path === '/20230401/organizations') return json({items: [organization]})
    if (path === `/20230401/organizations/${ORGANIZATION}`) return json(organization)
    if (path === `/20230401/organizations/${ORGANIZATION}/tenancies`) return json({items: [child, parent]})
    if (path === `/20230401/organizations/${ORGANIZATION}/tenancies/${CHILD}`) return json(child)
    if (path === '/20230401/links') return json({items: [link]})
    if (path === `/20230401/links/${LINK}`) return json(link)
    if (path === '/20230401/senderInvitations') return json({items: [sentInvitation]})
    if (path === `/20230401/senderInvitations/${SENT}`) return json(sentInvitation)
    if (path === '/20230401/recipientInvitations') return json({items: [receivedInvitation]})
    if (path === `/20230401/recipientInvitations/${RECEIVED}`) return json(receivedInvitation)
    return notFound()
}

describe('OciOrganizationsAdapter', () => {
    test('identifies itself and advertises only what it can do', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('organizations')
        const schema = instance.schema()
        expect(schema.actions).toEqual(['list', 'inspect'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name)).toEqual(['list', 'inspect'])
    })

    test('lists organizations, member tenancies, links and invitations together', async () => {
        const calls = stubFetch(populated)

        const rows = await adapter().list()

        expect(rows.map((row) => `${row.type}:${row.name}`)).toEqual([
            'Organization:floci-local',
            'Tenancy:acme-dev',
            'Tenancy:floci-local',
            'Link:CORE',
            'Sent invitation:join us',
            'Received invitation:welcome',
        ])
        expect(rows[1]).toMatchObject({
            id: CHILD,
            status: 'ACTIVE',
            region: null,
            createdAt: '2026-11-17T20:16:54.826781804Z',
            metadata: {role: 'CHILD', governanceStatus: 'OPTED_IN', isApprovedForTransfer: false, ocid: CHILD},
        })
        expect(rows[3].metadata).toMatchObject({feature: 'CORE', parentTenancyId: TENANCY, childTenancyId: CHILD})
        expect(rows[4].metadata).toMatchObject({invitationStatus: 'PENDING', recipientTenancyId: 'ocid1.tenancy.oc1..otherrecipient'})
        expect(rows[5].metadata).toMatchObject({senderTenancyId: 'ocid1.tenancy.oc1..sender'})
        // The organizations list is read once and shared by the organization and tenancy kinds.
        expect(calls.filter((call) => new URL(call).pathname === '/20230401/organizations')).toHaveLength(1)
        for (const call of calls.filter((each) => each.includes('?'))) {
            expect(new URL(call).searchParams.get('compartmentId')).toBe(TENANCY)
        }
    })

    test('is empty when the tenancy has no organization', async () => {
        stubFetch(() => json({items: []}))

        expect(await adapter().list()).toEqual([])
    })

    test('narrows the list to one kind with the kind facet', async () => {
        const calls = stubFetch(populated)

        const rows = await adapter().list({filters: {kind: 'links'}})

        expect(rows.map((row) => row.type)).toEqual(['Link'])
        expect(calls).toHaveLength(1)
        expect(new URL(calls[0]).pathname).toBe('/20230401/links')
    })

    test('lists member tenancies through the organizations that hold them', async () => {
        const calls = stubFetch(populated)

        const rows = await adapter().list({filters: {kind: 'tenancies'}})

        expect(rows.map((row) => row.name)).toEqual(['acme-dev', 'floci-local'])
        expect(calls.map((call) => new URL(call).pathname)).toEqual([
            '/20230401/organizations',
            `/20230401/organizations/${ORGANIZATION}/tenancies`,
        ])
    })

    test('rejects a kind it does not know', async () => {
        stubFetch(populated)

        await expect(adapter().list({filters: {kind: 'subscriptions'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('follows opc-next-page until a list runs out', async () => {
        const calls = stubFetch((url) => {
            if (url.searchParams.get('page') === 'p2') return json({items: [{...link, id: 'ocid1.link.oc1..two', feature: 'GOVERNANCE'}]})
            return new Response(JSON.stringify({items: [link]}), {status: 200, headers: {'opc-next-page': 'p2'}})
        })

        const rows = await adapter().list({filters: {kind: 'links'}})

        expect(rows.map((row) => row.name)).toEqual(['CORE', 'GOVERNANCE'])
        expect(calls).toHaveLength(2)
    })

    test('stops when the runtime repeats a page token', async () => {
        const calls = stubFetch(() => new Response(JSON.stringify({items: [link]}), {status: 200, headers: {'opc-next-page': 'same'}}))

        await adapter().list({filters: {kind: 'links'}})

        expect(calls).toHaveLength(2)
    })

    test('searches by name and id', async () => {
        stubFetch(populated)

        expect((await adapter().list({search: 'acme'})).map((row) => row.name)).toEqual(['acme-dev'])
        expect((await adapter().list({search: SENT.toUpperCase()})).map((row) => row.name)).toEqual(['join us'])
        expect(await adapter().list({search: 'nothing-matches'})).toEqual([])
    })

    test('fails the list when the runtime errors instead of returning a partial one', async () => {
        stubFetch((url) => (url.pathname === '/20230401/links'
            ? json({code: 'InternalServerError', message: 'boom'}, {status: 500})
            : populated(url)))

        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('inspects each kind from its own OCID', async () => {
        stubFetch(populated)

        expect(await adapter().get(ORGANIZATION)).toMatchObject({type: 'Organization', name: 'floci-local', metadata: {parentName: 'floci-local'}})
        expect(await adapter().get(LINK)).toMatchObject({type: 'Link', status: 'ACTIVE', metadata: {feature: 'CORE'}})
        expect(await adapter().get(SENT)).toMatchObject({type: 'Sent invitation', name: 'join us', metadata: {invitationStatus: 'PENDING'}})
        expect(await adapter().get(RECEIVED)).toMatchObject({type: 'Received invitation', name: 'welcome'})
    })

    test('inspects a member tenancy through the organization that holds it', async () => {
        const calls = stubFetch(populated)

        const row = await adapter().get(CHILD)

        expect(row).toMatchObject({id: CHILD, type: 'Tenancy', name: 'acme-dev', metadata: {organizationId: ORGANIZATION, role: 'CHILD'}})
        expect(calls.map((call) => new URL(call).pathname)).toEqual([
            '/20230401/organizations',
            `/20230401/organizations/${ORGANIZATION}/tenancies/${CHILD}`,
        ])
    })

    test('returns null for a record that is not there', async () => {
        stubFetch(populated)

        expect(await adapter().get('ocid1.link.oc1..missing')).toBeNull()
        expect(await adapter().get('ocid1.tenancy.oc1..stranger')).toBeNull()
    })

    test('rejects an id that is not an organizations OCID', async () => {
        await expect(adapter().get('not-an-ocid')).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().get('ocid1.bucket.oc1..x')).rejects.toBeInstanceOf(ValidationError)
    })

    test('does not create or delete records', async () => {
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(NotSupportedError)
        await expect(adapter().delete(LINK)).rejects.toBeInstanceOf(NotSupportedError)
    })
})

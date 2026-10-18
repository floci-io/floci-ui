import {expect, test, type Page} from '@playwright/test'
import type {CloudResource} from '../src/types/resource'

const keyId = 'ocid1.key.oc1.iad.signer'
const key: CloudResource = {
    id: keyId, name: 'signer', cloud: 'oci', service: 'kms', type: 'key', region: 'us-ashburn-1',
    createdAt: null, status: 'ENABLED',
    metadata: {algorithm: 'ECDSA', curveId: 'NIST_P256', keyUsage: 'SIGN_VERIFY', enabled: true, currentKeyVersion: 'v1'},
}

async function mockOciKms(page: Page, operations: string[]) {
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname)
        let json: unknown
        if (path === '/api/clouds') json = [{id: 'oci', displayName: 'OCI', availability: 'available'}]
        else if (path.endsWith('/status')) json = {cloud: 'oci', runtime: 'reachable', adapterRegistered: true, endpoint: 'http://localhost:4604'}
        else if (path.endsWith('/services')) json = [{cloud: 'oci', service: 'kms', displayName: 'Vault', route: 'kms', group: 'Security', availability: 'available', iconKey: 'kms'}]
        else if (path.endsWith('/schema')) json = {
            cloud: 'oci', service: 'kms', displayName: 'Vault', actions: ['list', 'inspect', 'rotate', 'sign', 'verify'],
            fields: [], filters: [], columns: [{name: 'name', label: 'Name'}],
            capabilities: {resourceActions: ['list', 'inspect', 'rotate', 'sign', 'verify']},
        }
        else if (path.endsWith('/resources')) json = [key]
        else if (path.endsWith(`/resources/${keyId}`)) json = key
        else if (path.endsWith('/sign')) {
            const body = route.request().postDataJSON()
            operations.push(`sign:${body.messageBase64}:${body.signingAlgorithm}`)
            json = {signatureBase64: 'AQID', keyId, keyVersionId: 'v1', signingAlgorithm: 'ECDSA_SHA_256'}
        } else if (path.endsWith('/verify')) {
            const body = route.request().postDataJSON()
            operations.push(`verify:${body.messageBase64}:${body.signatureBase64}:${body.keyVersionId}`)
            json = {isSignatureValid: true}
        } else throw new Error(`Unexpected API request: ${path}`)
        await route.fulfill({json})
    })
}

test('OCI sign-only key signs and verifies in Cloud Explorer without an encryption control', async ({page}, testInfo) => {
    const operations: string[] = []
    await mockOciKms(page, operations)
    await page.goto('/cloud-explorer/oci/kms')
    await page.getByRole('cell', {name: 'signer', exact: true}).click()
    await expect(page.getByRole('heading', {name: 'Key operations'})).toBeVisible()
    await expect(page.getByRole('heading', {name: 'Encrypt and decrypt'})).toHaveCount(0)
    await page.locator('.oci-kms-actions').screenshot({path: testInfo.outputPath('before-signing.png')})

    await page.getByLabel('Message (UTF-8)').fill('hello')
    await page.getByRole('button', {name: 'Sign', exact: true}).last().click()
    await expect(page.getByText('AQID')).toBeVisible()
    await page.getByRole('button', {name: 'Use in Verify'}).click()
    await page.getByRole('button', {name: 'Verify', exact: true}).last().click()
    await expect(page.getByText('Signature valid')).toBeVisible()
    expect(operations).toEqual(['sign:aGVsbG8=:ECDSA_SHA_256', 'verify:aGVsbG8=:AQID:v1'])
    await page.locator('.oci-kms-actions').screenshot({path: testInfo.outputPath('after-verification.png')})
})

import {describe, expect, it} from 'bun:test'
import {cloudEndpoint} from './endpoints'

describe('cloudEndpoint', () => {
    it('falls back to the documented local endpoints', () => {
        expect(cloudEndpoint('aws', {})).toBe('http://localhost:4566')
        expect(cloudEndpoint('azure', {})).toBe('http://localhost:4577')
        expect(cloudEndpoint('gcp', {})).toBe('http://localhost:4588')
        expect(cloudEndpoint('oci', {})).toBe('http://localhost:4599')
    })

    it('reads FLOCI_ENDPOINT as the AWS endpoint when no emulator names its cloud', () => {
        const env = {FLOCI_ENDPOINT: 'http://floci:4566'}
        expect(cloudEndpoint('aws', env)).toBe('http://floci:4566')
        expect(cloudEndpoint('azure', env)).toBe('http://localhost:4577')
    })

    it('reads FLOCI_ENDPOINT as the endpoint of the cloud in FLOCI_CLOUD', () => {
        const env = {FLOCI_CLOUD: 'az', FLOCI_ENDPOINT: 'http://floci-az:4577'}
        expect(cloudEndpoint('azure', env)).toBe('http://floci-az:4577')
        // The case the contract exists for: AWS calls must not go to floci-az.
        expect(cloudEndpoint('aws', env)).toBe('http://localhost:4566')
    })

    it('reads FLOCI_ENDPOINT for GCP and OCI under their own scope only', () => {
        expect(cloudEndpoint('gcp', {FLOCI_CLOUD: 'gcp', FLOCI_ENDPOINT: 'http://g:4588'})).toBe('http://g:4588')
        expect(cloudEndpoint('oci', {FLOCI_CLOUD: 'oci', FLOCI_ENDPOINT: 'http://o:4599'})).toBe('http://o:4599')
        expect(cloudEndpoint('oci', {FLOCI_CLOUD: 'gcp', FLOCI_ENDPOINT: 'http://g:4588'})).toBe('http://localhost:4599')
    })

    it("prefers a cloud's own variable over FLOCI_ENDPOINT", () => {
        const env = {FLOCI_CLOUD: 'az', FLOCI_ENDPOINT: 'http://a:4577', FLOCI_AZURE_ENDPOINT: 'http://b:4577'}
        expect(cloudEndpoint('azure', env)).toBe('http://b:4577')
        expect(cloudEndpoint('azure', {FLOCI_AZ_ENDPOINT: 'http://c:4577'})).toBe('http://c:4577')
        expect(cloudEndpoint('gcp', {FLOCI_GP_ENDPOINT: 'http://g:4588'})).toBe('http://g:4588')
    })

    it('uses AWS_ENDPOINT_URL when FLOCI_ENDPOINT does not name AWS', () => {
        expect(cloudEndpoint('aws', {AWS_ENDPOINT_URL: 'http://floci:4566'})).toBe('http://floci:4566')
        expect(cloudEndpoint('aws', {FLOCI_CLOUD: 'aws', FLOCI_ENDPOINT: 'http://a:4566', AWS_ENDPOINT_URL: 'http://b:4566'}))
            .toBe('http://a:4566')
    })

    it('treats an unknown FLOCI_CLOUD as unscoped, and blank values as unset', () => {
        expect(cloudEndpoint('aws', {FLOCI_CLOUD: 'ibm', FLOCI_ENDPOINT: 'http://floci:4566'})).toBe('http://floci:4566')
        expect(cloudEndpoint('aws', {FLOCI_ENDPOINT: '  '})).toBe('http://localhost:4566')
        expect(cloudEndpoint('azure', {FLOCI_AZURE_ENDPOINT: ''})).toBe('http://localhost:4577')
    })
})

import {isCloudProvider} from '@/lib/cloudProvider'

describe('isCloudProvider', () => {
    it('accepts every supported cloud', () => {
        for (const cloud of ['aws', 'azure', 'gcp', 'oci']) {
            expect(isCloudProvider(cloud)).toBe(true)
        }
    })

    it('rejects unknown or missing values', () => {
        expect(isCloudProvider('ibm')).toBe(false)
        expect(isCloudProvider('AWS')).toBe(false)
        expect(isCloudProvider(undefined)).toBe(false)
    })
})

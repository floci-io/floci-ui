import {describe, expect, test} from 'bun:test'
import {catalogEntry, type ServiceCatalogEntry} from './serviceCatalog'
import {serviceMatrixLabel} from './serviceMatrix'

function entry(service: string): ServiceCatalogEntry {
    const found = catalogEntry(service)
    if (!found) throw new Error(`no catalog entry for ${service}`)
    return found
}

describe('serviceMatrixLabel', () => {
    test('names the product of a service offered on one cloud', () => {
        expect(serviceMatrixLabel(entry('sns'), ['aws'])).toBe('Notifications (AWS: SNS)')
    })

    test('names each cloud product in matrix column order', () => {
        expect(serviceMatrixLabel(entry('secrets'), ['oci', 'gcp', 'azure', 'aws'])).toBe(
            'Secrets (AWS: Secrets Manager, Azure: Key Vault, GCP: Secret Manager, OCI: Vault Secrets)',
        )
    })

    test('leaves out clouds that do not offer the service', () => {
        expect(serviceMatrixLabel(entry('sagemaker'), ['aws'])).toBe('Machine Learning (AWS: SageMaker AI)')
    })

    test('leaves out a cloud whose product name is the neutral name', () => {
        expect(serviceMatrixLabel(entry('registry'), ['aws', 'azure'])).toBe(
            'Container Registry (AWS: ECR)',
        )
    })

    test('keeps the neutral name alone when no offering cloud renames the service', () => {
        expect(serviceMatrixLabel(entry('compute'), ['aws', 'azure', 'gcp'])).toBe('Compute')
        expect(serviceMatrixLabel(entry('sns'), [])).toBe('Notifications')
    })
})

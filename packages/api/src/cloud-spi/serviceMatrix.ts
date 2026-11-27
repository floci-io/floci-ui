import {displayNameFor, type ServiceCatalogEntry} from './serviceCatalog'
import type {CloudProvider} from './types'

export const MATRIX_CLOUDS: CloudProvider[] = ['aws', 'azure', 'gcp', 'oci']
export const CLOUD_LABELS: Record<CloudProvider, string> = {aws: 'AWS', azure: 'Azure', gcp: 'GCP', oci: 'OCI'}

/**
 * The README matrix's Service cell: the neutral name, followed by each product
 * name a cloud shows instead, so a search for SNS or SageMaker finds its row.
 * Only clouds that offer the service are named, in matrix column order.
 */
export function serviceMatrixLabel(entry: ServiceCatalogEntry, offeredOn: readonly CloudProvider[]): string {
    const productNames = MATRIX_CLOUDS
        .filter((cloud) => offeredOn.includes(cloud))
        .map((cloud) => ({cloud, name: displayNameFor(entry, cloud)}))
        .filter(({name}) => name !== entry.displayName)
        .map(({cloud, name}) => `${CLOUD_LABELS[cloud]}: ${name}`)

    return productNames.length > 0 ? `${entry.displayName} (${productNames.join(', ')})` : entry.displayName
}

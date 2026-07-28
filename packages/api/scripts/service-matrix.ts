/**
 * Print the service-coverage matrix as markdown, derived from the service
 * catalog and the adapter registry.
 *
 * The README table used to be hand-maintained and drifted from the code. Paste
 * this output into the README whenever navigation changes:
 *
 *     bun run scripts/service-matrix.ts
 *
 * Reads the registry only — no runtime calls — so it works offline.
 */

import {createCloudAdapterRegistry} from '../src/cloudProxy'
import {SERVICE_CATALOG_ENTRIES, displayNameFor} from '../src/cloud-spi/serviceCatalog'
import type {CloudProvider} from '../src/cloud-spi/types'

const CLOUDS: CloudProvider[] = ['aws', 'azure', 'gcp']
const CLOUD_LABELS: Record<CloudProvider, string> = {aws: 'AWS', azure: 'Azure', gcp: 'GCP'}

const registry = createCloudAdapterRegistry()

function cell(cloud: CloudProvider, service: string): string {
    const entry = SERVICE_CATALOG_ENTRIES.find((candidate) => candidate.service === service)
    const legacy = entry?.legacyAvailability?.[cloud]
    if (legacy === 'available') return 'Yes (legacy page)'

    const adapter = registry.get(cloud, service as never)
    if (!adapter) return 'No'

    const override = adapter.descriptorOverride?.()
    if (override?.availability === 'coming_soon') return 'Runtime gap'

    const actions = adapter.schema().actions
    return `Yes (${actions.join(', ')})`
}

const rows = SERVICE_CATALOG_ENTRIES.map((entry) => {
    const names = new Set(CLOUDS.map((cloud) => displayNameFor(entry, cloud)))
    // Show per-cloud names inline when they differ, e.g. EKS / AKS / GKE.
    const label = names.size === 1 ? entry.displayName : [...names].join(' / ')
    return `| ${entry.group} | ${label} | ${CLOUDS.map((cloud) => cell(cloud, entry.service)).join(' | ')} |`
})

console.log(`| Group | Service | ${CLOUDS.map((cloud) => CLOUD_LABELS[cloud]).join(' | ')} |`)
console.log(`|---|---|${CLOUDS.map(() => '---').join('|')}|`)
console.log(rows.join('\n'))

const runtimeGaps = CLOUDS.flatMap((cloud) =>
    SERVICE_CATALOG_ENTRIES.flatMap((entry) => {
        const override = registry.get(cloud, entry.service as never)?.descriptorOverride?.()
        return override?.reason ? [`- ${CLOUD_LABELS[cloud]} ${displayNameFor(entry, cloud)}: ${override.reason}`] : []
    }),
)

if (runtimeGaps.length > 0) {
    console.log('\nRuntime gaps:\n')
    console.log(runtimeGaps.join('\n'))
}

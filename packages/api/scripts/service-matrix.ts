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
import {CLOUD_LABELS, MATRIX_CLOUDS as CLOUDS, serviceMatrixLabel} from '../src/cloud-spi/serviceMatrix'
import type {CloudProvider} from '../src/cloud-spi/types'

const NOT_AVAILABLE = '–'

const registry = createCloudAdapterRegistry()

function cell(cloud: CloudProvider, service: string): string {
    const entry = SERVICE_CATALOG_ENTRIES.find((candidate) => candidate.service === service)
    if (entry?.legacyAvailability?.[cloud] === 'available') return '✅'

    const adapter = registry.get(cloud, service as never)
    if (!adapter) return NOT_AVAILABLE

    if (adapter.descriptorOverride?.()?.availability === 'coming_soon') return '⏳'

    const actions = adapter.schema().actions
    return actions.includes('create') && actions.includes('delete') ? '✅' : '👁'
}

const rows = SERVICE_CATALOG_ENTRIES.map((entry) => {
    const cells = CLOUDS.map((cloud) => cell(cloud, entry.service))
    const offeredOn = CLOUDS.filter((_, index) => cells[index] !== NOT_AVAILABLE)
    return `| ${entry.group} | ${serviceMatrixLabel(entry, offeredOn)} | ${cells.join(' | ')} |`
})

console.log(`| Group | Service | ${CLOUDS.map((cloud) => CLOUD_LABELS[cloud]).join(' | ')} |`)
console.log(`|---|---|${CLOUDS.map(() => ':-:').join('|')}|`)
console.log(rows.join('\n'))
console.log('\n✅ list, inspect, create, delete · 👁 read-only or partial · ⏳ adapter registered, runtime gap · – not available')

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

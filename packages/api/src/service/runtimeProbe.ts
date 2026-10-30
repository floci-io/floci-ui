import type {CloudProvider} from '../cloud-spi/types'
import {azureEndpoint} from '../azure'
import {gcp, gcpEndpoint} from '../gcp'
import {oci, ociEndpoint} from '../oci'
import {cloudEndpoint} from './endpoints'
import {probeFlociHealth} from './flociHealth'

/**
 * Liveness probes per runtime.
 *
 * Cloud status used to be inferred from whether the *storage* adapter could list,
 * which meant a cloud whose storage worked reported "reachable" no matter what
 * else was broken, and a cloud with no storage adapter reported "coming_soon"
 * even when its runtime was up. These probe the runtime itself.
 */
export type RuntimeProbe = () => Promise<void>

export const runtimeProbes: Record<CloudProvider, RuntimeProbe> = {
    // Every runtime exposes a health endpoint, but under its own path: core and
    // Floci-AZ use /_floci/health, Floci-GCP and Floci-OCI use /_floci-<cloud>/health.
    aws: () => probeFlociHealth({endpoint: awsEndpoint(), path: '/_floci/health', label: 'Floci core', rejectClientErrors: false}),
    azure: () => probeFlociHealth({endpoint: azureEndpoint(), path: '/_floci/health', label: 'Floci-AZ', rejectClientErrors: true}),
    gcp: () => gcp.health(),
    oci: () => oci.health(),
}

export function endpointFor(cloud: CloudProvider): string | null {
    if (cloud === 'aws') return awsEndpoint()
    if (cloud === 'azure') return azureEndpoint()
    if (cloud === 'gcp') return gcpEndpoint()
    if (cloud === 'oci') return ociEndpoint()
    return null
}

export function awsEndpoint(): string {
    return cloudEndpoint('aws')
}

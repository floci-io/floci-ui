import type {CloudProvider} from '../cloud-spi/types'
import {resolveScopedCloud} from './defaultCloud'

type Env = Record<string, string | undefined>

const DEFAULT_ENDPOINTS: Readonly<Record<CloudProvider, string>> = {
    aws: 'http://localhost:4566',
    azure: 'http://localhost:4577',
    gcp: 'http://localhost:4588',
    oci: 'http://localhost:4599',
}

/** Each cloud's own endpoint variables, most specific first. */
const PROFILE_VARIABLES: Readonly<Record<CloudProvider, readonly string[]>> = {
    aws: ['AWS_ENDPOINT_URL'],
    azure: ['FLOCI_AZURE_ENDPOINT', 'FLOCI_AZ_ENDPOINT'],
    gcp: ['FLOCI_GCP_ENDPOINT', 'FLOCI_GP_ENDPOINT'],
    oci: ['FLOCI_OCI_ENDPOINT'],
}

/**
 * The endpoint the console reaches `cloud`'s emulator at.
 *
 * Under Console Contract v2, FLOCI_ENDPOINT is the endpoint of the emulator named
 * by FLOCI_CLOUD, so it only counts for that cloud. Without FLOCI_CLOUD it keeps
 * its older meaning, the AWS endpoint, which is what standalone setups and
 * Floci core rely on. A cloud's own variable wins over FLOCI_ENDPOINT, except
 * for AWS, where FLOCI_ENDPOINT predates AWS_ENDPOINT_URL here and both name the
 * same endpoint when Floci core sets them.
 */
export function cloudEndpoint(cloud: CloudProvider, env: Env = process.env): string {
    const flociEndpoint = present(env.FLOCI_ENDPOINT)
    const scope = resolveScopedCloud(env)
    const flociEndpointIsOurs = flociEndpoint !== undefined && (scope === cloud || (scope === null && cloud === 'aws'))
    const profile = PROFILE_VARIABLES[cloud].map((name) => present(env[name])).find((value) => value !== undefined)

    if (cloud === 'aws' && flociEndpointIsOurs) return flociEndpoint
    return profile ?? (flociEndpointIsOurs ? flociEndpoint : undefined) ?? DEFAULT_ENDPOINTS[cloud]
}

function present(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
}

import type {CloudProvider} from '@/types/cloud'

const CLOUD_PROVIDERS: ReadonlySet<string> = new Set<CloudProvider>(['aws', 'azure', 'gcp', 'oci'])

export function isCloudProvider(value: string | undefined): value is CloudProvider {
    return value !== undefined && CLOUD_PROVIDERS.has(value)
}

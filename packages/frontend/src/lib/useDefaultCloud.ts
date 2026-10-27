import {useCloudsQuery} from '@/api/queries/cloudQueries'
import type {CloudDescriptor, CloudProvider} from '@/types/cloud'

/** The cloud marked default in the list, else AWS. */
export function defaultCloudOf(clouds: CloudDescriptor[] | undefined): CloudProvider {
    return clouds?.find((cloud) => cloud.default)?.id ?? 'aws'
}

/**
 * Whether the console serves `cloud`. An emulator that starts the console
 * scopes it to its own cloud, and the API then lists only that one. Until the
 * list has arrived every cloud is allowed, so only a confirmed list excludes one.
 */
export function isAllowedCloud(clouds: CloudDescriptor[] | undefined, cloud: CloudProvider): boolean {
    return !clouds || clouds.some((entry) => entry.id === cloud)
}

/**
 * The cloud the console opens on: the one the emulator that started it named
 * in FLOCI_CLOUD, else AWS. `pending` is true until the API has answered, so a
 * redirect can wait rather than land on AWS first.
 */
export function useDefaultCloud(): {cloud: CloudProvider; pending: boolean} {
    const {data, isPending} = useCloudsQuery()
    return {cloud: defaultCloudOf(data), pending: isPending}
}

/** {@link isAllowedCloud} against the API's list. */
export function useAllowedCloud(cloud: CloudProvider): boolean {
    const {data} = useCloudsQuery()
    return isAllowedCloud(data, cloud)
}

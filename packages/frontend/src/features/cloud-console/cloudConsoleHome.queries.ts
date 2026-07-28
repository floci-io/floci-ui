/**
 * Re-export shim. These queries moved to api/queries/cloudQueries so the app
 * shell can use them without importing from a feature folder.
 */
export {
    cloudQueryKeys as cloudConsoleHomeQueryKeys,
    useCloudConsoleResourcesQuery,
    useCloudServiceStatusQuery,
    useCloudServicesQuery,
    useCloudStatusQuery,
    useCloudsQuery,
} from '@/api/queries/cloudQueries'

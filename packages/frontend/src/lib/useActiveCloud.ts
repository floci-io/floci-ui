import {useEffect} from 'react'
import {matchPath, useLocation} from 'react-router-dom'
import {isCloudProvider} from '@/lib/cloudProvider'
import {isAllowedCloud, useDefaultCloud} from '@/lib/useDefaultCloud'
import {useCloudsQuery} from '@/api/queries/cloudQueries'
import type {CloudProvider} from '@/types/cloud'

const LAST_CLOUD_KEY = 'floci-last-cloud'

function rememberedCloud(fallback: CloudProvider): CloudProvider {
    try {
        const stored = sessionStorage.getItem(LAST_CLOUD_KEY) ?? undefined
        return isCloudProvider(stored) ? stored : fallback
    } catch {
        return fallback
    }
}

export function useActiveCloud(): CloudProvider {
    const location = useLocation()
    const {cloud: defaultCloud} = useDefaultCloud()
    const {data: clouds} = useCloudsQuery()
    const pathCloud = location.pathname.match(/^\/(?:cloud-explorer|console)\/([^/]+)/)?.[1]
    const stateCloud = location.state?.cloud
    const settingsCloud = isCloudProvider(stateCloud) ? stateCloud : rememberedCloud(defaultCloud)
    const cloud = isCloudProvider(pathCloud)
        ? pathCloud
        : matchPath('/settings', location.pathname)
            // A cloud remembered from a standalone session is not one a scoped console serves.
            ? isAllowedCloud(clouds, settingsCloud) ? settingsCloud : defaultCloud
            : defaultCloud

    useEffect(() => {
        try {
            sessionStorage.setItem(LAST_CLOUD_KEY, cloud)
        } catch {
            // Navigation state still preserves the cloud when browser storage is unavailable.
        }
    }, [cloud])

    return cloud
}

import {useEffect} from 'react'
import {matchPath, useLocation} from 'react-router-dom'
import {isCloudProvider} from '@/lib/cloudProvider'
import type {CloudProvider} from '@/types/cloud'

const LAST_CLOUD_KEY = 'floci-last-cloud'

function rememberedCloud(): CloudProvider {
    try {
        const stored = sessionStorage.getItem(LAST_CLOUD_KEY) ?? undefined
        return isCloudProvider(stored) ? stored : 'aws'
    } catch {
        return 'aws'
    }
}

export function useActiveCloud(): CloudProvider {
    const location = useLocation()
    const pathCloud = location.pathname.match(/^\/(?:cloud-explorer|console)\/([^/]+)/)?.[1]
    const stateCloud = location.state?.cloud
    const cloud = isCloudProvider(pathCloud)
        ? pathCloud
        : matchPath('/settings', location.pathname)
            ? isCloudProvider(stateCloud) ? stateCloud : rememberedCloud()
            : 'aws'

    useEffect(() => {
        try {
            sessionStorage.setItem(LAST_CLOUD_KEY, cloud)
        } catch {
            // Navigation state still preserves the cloud when browser storage is unavailable.
        }
    }, [cloud])

    return cloud
}

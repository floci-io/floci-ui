import type {ReactNode} from 'react'
import {Navigate, useParams} from 'react-router-dom'
import {isCloudProvider} from '@/lib/cloudProvider'
import {useAllowedCloud, useDefaultCloud} from '@/lib/useDefaultCloud'
import type {CloudProvider} from '@/types/cloud'

/**
 * Sends the browser to the default cloud's Console Home, or its Cloud Explorer.
 * Renders nothing until the API has said which cloud that is, so a console
 * started by Floci-AZ never shows AWS first.
 */
export function DefaultCloudRedirect({to}: {to: 'console' | 'cloud-explorer'}) {
    const {cloud, pending} = useDefaultCloud()
    if (pending) {
        return null
    }
    return <Navigate to={to === 'console' ? `/console/${cloud}` : `/cloud-explorer/${cloud}/storage`} replace/>
}

/**
 * Renders a `:cloud` page only for a cloud the console serves. A console an
 * emulator started serves that emulator's cloud alone, so a link or bookmark to
 * another cloud goes to the default cloud's Console Home instead. A page that
 * belongs to one cloud and has no `:cloud` segment names it in `cloud`.
 */
export function ScopedCloudRoute({children, cloud: pageCloud}: {children: ReactNode; cloud?: CloudProvider}) {
    const params = useParams()
    const cloud = pageCloud ?? params.cloud
    const allowed = useAllowedCloud(isCloudProvider(cloud) ? cloud : 'aws')
    if (isCloudProvider(cloud) && !allowed) {
        return <DefaultCloudRedirect to="console"/>
    }
    return <>{children}</>
}

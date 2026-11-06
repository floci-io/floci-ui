import {Link, matchPath, useLocation} from 'react-router-dom'
import {useCloudServicesQuery} from '@/api/queries/cloudQueries'
import {BreadcrumbTrail, type Crumb} from '@/components/sodium/ui/breadcrumb'
import {useActiveCloud} from '@/lib/useActiveCloud'

/**
 * The trail from the cloud down to the page you are on, each level a link back: AWS / Console Home / DynamoDB /
 * orders / Data. It is built from the route, so every screen has one and nothing has to register its place.
 */
export function AppBreadcrumbs() {
    const {pathname} = useLocation()
    const activeCloud = useActiveCloud()

    const data = matchPath('/cloud-explorer/:cloud/:service/:resourceId/data', pathname)
    const explorer = matchPath('/cloud-explorer/:cloud/:service', pathname)
    const consoleHome = matchPath('/console/:cloud', pathname)
    const route = data ?? explorer ?? consoleHome
    const cloud = (route?.params.cloud as typeof activeCloud | undefined) ?? activeCloud
    const serviceId = data?.params.service ?? explorer?.params.service

    const servicesQuery = useCloudServicesQuery(cloud)
    const serviceName = serviceId
        ? servicesQuery.data?.find((item) => item.service === serviceId)?.displayName ?? serviceId
        : undefined

    const home: Crumb = {label: 'Console Home', href: `/console/${cloud}`}
    const root: Crumb = {label: cloud.toUpperCase(), href: `/console/${cloud}`}
    let items: Crumb[]

    if (data && serviceName) {
        items = [
            root,
            home,
            {label: serviceName, href: `/cloud-explorer/${cloud}/${serviceId}`},
            {label: decodeURIComponent(data.params.resourceId ?? ''), value: true, href: `/cloud-explorer/${cloud}/${serviceId}`},
            {label: 'Data'},
        ]
    } else if (explorer && serviceName) {
        items = [root, home, {label: serviceName}]
    } else if (consoleHome) {
        items = [root, {label: 'Console Home'}]
    } else if (pathname === '/settings') {
        items = [root, home, {label: 'Settings'}]
    } else if (pathname === '/secretsmanager') {
        items = [root, home, {label: 'Secrets Manager'}]
    } else {
        return null
    }

    return (
        <div className="shrink-0 border-b border-line px-4 py-2">
            <BreadcrumbTrail
                items={items}
                aria-label="Breadcrumb"
                renderLink={(href) => <Link to={href}/>}
            />
        </div>
    )
}

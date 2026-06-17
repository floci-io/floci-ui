import {NavLink, Outlet, useLocation} from 'react-router-dom'
import {
    Database,
    Boxes,
    KeyRound,
    LayoutDashboard,
    MessageSquare,
    Moon,
    Network,
    Search,
    Server,
    Sun,
    Table2,
    Zap,
} from 'lucide-react'
import flociWhite from '@/assets/floci-white.svg'
import flociBlack from '@/assets/floci-black.svg'
import {useTheme} from '@/lib/useTheme'
import {useQuery} from '@tanstack/react-query'
import {getCloudStatus} from '@/api/cloudProxyClient'
import {AccountSwitcher} from '@/components/AccountSwitcher'

function NavItem({to, icon, label}: { to: string; icon: React.ElementType; label: string }) {
    const Icon = icon
    return (
        <NavLink className="nav-link" to={to}>
            <Icon size={14}/>
            <span>{label}</span>
        </NavLink>
    )
}

const CLOUD_SERVICE_ICONS = {
    storage: Database,
    k8s: Boxes,
    secretsmanager: KeyRound,
    queue: MessageSquare,
    function: Zap,
    database: Table2,
    compute: Server,
    networking: Network,
    serverless: Zap,
} satisfies Record<string, React.ElementType>

type CloudSidebarService = keyof typeof CLOUD_SERVICE_ICONS

const CLOUD_SERVICE_ITEMS: Array<{name: CloudSidebarService; label: string; route?: string}> = [
    {name: 'storage', label: 'Storage', route: 'storage'},
    {name: 'k8s', label: 'k8s Engine', route: 'k8s'},
    {name: 'database', label: 'Database', route: 'database'},
    {name: 'compute', label: 'Compute', route: 'compute'},
    {name: 'networking', label: 'Networking', route: 'networking'},
    {name: 'secretsmanager', label: 'Secrets Manager', route: '/secretsmanager'},
    {name: 'serverless', label: 'Serverless', route: 'serverless'},
    {name: 'queue', label: 'Queue'},
    {name: 'function', label: 'Function'},
]

function CloudServiceNav() {
    const location = useLocation()
    const cloud = activeCloudFromPath(location.pathname)
    const cloudLabel = cloud.toUpperCase()

    return (
        <div className="nav-section cloud-service-nav">
            <span className="nav-label">Cloud Services · {cloudLabel}</span>
            {CLOUD_SERVICE_ITEMS.map((service) => {
                const Icon = CLOUD_SERVICE_ICONS[service.name]
                const available = service.name === 'storage'
                    || (service.name === 'secretsmanager' && cloud === 'aws')
                    || (service.name === 'database' && (cloud === 'aws' || cloud === 'azure'))
                    || ((service.name === 'k8s' || service.name === 'compute' || service.name === 'networking' || service.name === 'serverless') && cloud === 'aws')
                if (service.route && available) {
                    const target = service.route.startsWith('/') ? service.route : `/cloud-explorer/${cloud}/${service.route}`
                    return <NavItem key={service.name} to={target} icon={Icon} label={service.label}/>
                }

                return (
                    <div key={service.name} className="nav-link disabled">
                        <Icon size={14}/>
                        <span>{service.label}</span>
                        <span className="nav-soon">Soon</span>
                    </div>
                )
            })}
        </div>
    )
}

export function Layout() {
    const location = useLocation()
    const activeCloud = activeCloudFromPath(location.pathname)
    const {theme, toggle} = useTheme()
    const {data, isError} = useQuery({
        queryKey: ['cloud-status', activeCloud],
        queryFn: ({signal}) => getCloudStatus(activeCloud, signal),
        refetchInterval: 5000
    })
    const status = isError ? 'unavailable' : data?.runtime ?? 'unknown'
    const isConnected = status === 'reachable'
    const connectionLabel = isConnected ? 'Connected' : 'Not connected'
    const connectionTarget = data?.endpoint ?? activeCloud

    return (
        <div className="app">
            <aside className="sidebar">
                <div className="brand">
                    <img className="brand-logo" src={theme === 'dark' ? flociWhite : flociBlack} alt="Floci"/>
                    <p>Local Cloud</p>
                </div>

                <nav className="nav">
                    <div className="nav-section">
                        <span className="nav-label">General</span>
                        <NavItem to={`/console/${activeCloud}`} icon={LayoutDashboard} label="Console Home"/>
                    </div>
                    <CloudServiceNav/>
                </nav>

                <div className="sidebar-footer">Floci DevTools · Local</div>
            </aside>

            <div className="shell">
                <header className="topbar">
                    <div className="search">
                        <Search size={14}/>
                        <input placeholder="Search services, features, docs, and more"/>
                        <span className="kbd">/</span>
                    </div>
                    <button className="icon-btn" onClick={toggle} title="Toggle theme">
                        {theme === 'dark' ? <Sun size={14}/> : <Moon size={14}/>}
                    </button>
                    <AccountSwitcher/>
                    <div className={`connection ${isConnected ? 'connected' : 'disconnected'}`}>
                        <span className={`dot ${status}`}/>
                        <span className="connection-state">{connectionLabel}</span>
                        <span className="connection-target">{connectionTarget}</span>
                    </div>
                </header>
                <main className="main">
                    <Outlet/>
                </main>
            </div>
        </div>
    )
}

function activeCloudFromPath(pathname: string): 'aws' | 'azure' | 'gcp' {
    const match = pathname.match(/^\/(?:cloud-explorer|console)\/(aws|azure|gcp)(?:\/|$)/)
    return (match?.[1] ?? 'aws') as 'aws' | 'azure' | 'gcp'
}

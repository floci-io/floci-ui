import {NavLink, Outlet, useLocation, useSearchParams} from 'react-router-dom'
import {AlertTriangle, ChevronsLeft, ChevronsRight, LayoutDashboard, Moon, Search, Sun} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'
import flociWhite from '@/assets/floci-white.svg'
import flociBlack from '@/assets/floci-black.svg'
import flociMarkWhite from '@/assets/floci-mark-white.svg'
import flociMarkBlack from '@/assets/floci-mark-black.svg'
import {useTheme} from '@/lib/useTheme'
import {useSidebar} from '@/lib/useSidebar'
import {useQuery} from '@tanstack/react-query'
import {getCloudStatus} from '@/api/cloudProxyClient'
import {useCloudServicesQuery} from '@/api/queries/cloudQueries'
import {AccountSwitcher} from '@/components/AccountSwitcher'
import {serviceIcon} from '@/components/serviceIcons'
import type {CloudProvider, CloudServiceDescriptor, RuntimeReachability} from '@/types/cloud'

/** The runtime's reachability, plus the state before the status query answers. */
type ConnectionStatus = RuntimeReachability | 'unknown'

/**
 * Only a definitive answer gets a colour.
 *
 * `unknown` (status query still in flight — which is first paint and every
 * cloud switch) and `coming_soon` (runtime not wired) keep the neutral base
 * grey. Colouring anything that is not `reachable` red made the dot flash
 * green → red → green on each switch, and start red on load.
 */
function connectionDotClass(status: ConnectionStatus): string {
    if (status === 'reachable') return 'dot healthy'
    if (status === 'unavailable') return 'dot unavailable'
    return 'dot'
}

/** Matches today's service count, so the real nav causes no layout jump. */
const SKELETON_ROWS = 7

function NavItem({to, icon, label}: { to: string; icon: React.ElementType; label: string }) {
    const Icon = icon
    return (
        <NavLink className="nav-link" to={to} title={label}>
            <Icon size={14}/>
            <span>{label}</span>
        </NavLink>
    )
}

/**
 * The nav is rendered entirely from `GET /clouds/:cloud/services`.
 *
 * It used to be a hardcoded item list plus a per-cloud boolean that never
 * consulted the server, so registering an adapter did not light up the nav and
 * availability could disagree with the API. Adding a service is now a catalog
 * row on the server and nothing here.
 */
function CloudServiceNav() {
    const location = useLocation()
    const cloud = activeCloudFromPath(location.pathname)
    const cloudLabel = cloud.toUpperCase()
    const {data, isPending, isError, refetch, isFetching} = useCloudServicesQuery(cloud)

    if (isPending) return <CloudServiceNavSkeleton cloudLabel={cloudLabel}/>

    if (isError) {
        return (
            <div className="nav-section cloud-service-nav">
                <span className="nav-label">Cloud Services · {cloudLabel}</span>
                <div className="nav-link disabled nav-error" title="Services unavailable">
                    <AlertTriangle size={14}/>
                    <span>Services unavailable</span>
                </div>
                <button className="nav-retry" type="button" disabled={isFetching} onClick={() => void refetch()}>
                    {isFetching ? 'Retrying…' : 'Retry'}
                </button>
            </div>
        )
    }

    const groups = groupByGroup(data ?? [])

    return (
        <div className="nav-section cloud-service-nav">
            <span className="nav-label">Cloud Services · {cloudLabel}</span>
            {groups.map(([group, services]) => (
                <div className="nav-group" key={group}>
                    <span className="nav-group-label">{group}</span>
                    {services.map((service) => (
                        <CloudServiceNavItem key={service.service} cloud={cloud} service={service}/>
                    ))}
                </div>
            ))}
        </div>
    )
}

function CloudServiceNavItem({cloud, service}: {cloud: CloudProvider; service: CloudServiceDescriptor}) {
    const Icon = serviceIcon(service.iconKey)

    if (service.availability === 'available') {
        const target = service.route.startsWith('/')
            ? service.route
            : `/cloud-explorer/${cloud}/${service.route}`
        return <NavItem to={target} icon={Icon} label={service.displayName}/>
    }

    // The server explains why, so the chip is no longer a bare "Soon".
    return (
        <div
            className="nav-link disabled"
            title={service.reason ? `${service.displayName} — ${service.reason}` : service.displayName}
        >
            <Icon size={14}/>
            <span>{service.displayName}</span>
            <span className="nav-soon">Soon</span>
        </div>
    )
}

function CloudServiceNavSkeleton({cloudLabel}: {cloudLabel: string}) {
    return (
        <div className="nav-section cloud-service-nav">
            <span className="nav-label">Cloud Services · {cloudLabel}</span>
            {Array.from({length: SKELETON_ROWS}, (_, index) => (
                <div className="nav-link nav-skeleton" key={index} aria-hidden="true">
                    <span className="skeleton-bar"/>
                </div>
            ))}
        </div>
    )
}

/** Preserves the server's ordering while bucketing into its groups. */
function groupByGroup(services: CloudServiceDescriptor[]): Array<[string, CloudServiceDescriptor[]]> {
    const groups = new Map<string, CloudServiceDescriptor[]>()
    for (const service of services) {
        const existing = groups.get(service.group)
        if (existing) existing.push(service)
        else groups.set(service.group, [service])
    }
    return [...groups]
}

export function Layout() {
    const location = useLocation()
    const activeCloud = activeCloudFromPath(location.pathname)
    const {theme, toggle} = useTheme()
    const {collapsed, toggle: toggleSidebar, toggleRef} = useSidebar()
    const isDark = theme === 'dark'
    const {data, isError} = useQuery({
        queryKey: ['cloud-status', activeCloud],
        queryFn: ({signal}) => getCloudStatus(activeCloud, signal),
        refetchInterval: 5000
    })
    const status: ConnectionStatus = isError ? 'unavailable' : data?.runtime ?? 'unknown'
    const isConnected = status === 'reachable'
    const connectionLabel = isConnected ? 'Connected' : 'Not connected'
    const connectionTarget = data?.endpoint ?? activeCloud

    return (
        <div className="app">
            <aside className="sidebar">
                <div className="sidebar-inner">
                    <div className="brand">
                        <img className="brand-logo" src={isDark ? flociWhite : flociBlack} alt="Floci"/>
                        <img className="brand-mark" src={isDark ? flociMarkWhite : flociMarkBlack} alt="" aria-hidden="true"/>
                        <p>Local Cloud</p>
                    </div>

                    <nav className="nav">
                        <div className="nav-section">
                            <span className="nav-label">General</span>
                            <NavItem to={`/console/${activeCloud}`} icon={LayoutDashboard} label="Console Home"/>
                        </div>
                        <CloudServiceNav/>
                    </nav>

                    <div className="sidebar-footer">
                        <span className="sidebar-footer-text">Floci DevTools · Local</span>
                        <button
                            ref={toggleRef}
                            className="icon-btn"
                            type="button"
                            onClick={toggleSidebar}
                            aria-expanded={!collapsed}
                            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {collapsed ? <ChevronsRight size={14}/> : <ChevronsLeft size={14}/>}
                        </button>
                    </div>
                </div>
            </aside>

            <div className="shell">
                <header className="topbar">
                    <TopbarSearch/>
                    <button className="icon-btn" onClick={toggle} title="Toggle theme">
                        {isDark ? <Sun size={14}/> : <Moon size={14}/>}
                    </button>
                    <div id="topbar-status" className="topbar-status"/>
                    <AccountSwitcher/>
                    <div className={`connection ${isConnected ? 'connected' : 'disconnected'}`}>
                        <span className={connectionDotClass(status)}/>
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

/**
 * Topbar search bar.
 *
 * Reads the initial value from the `search` URL query parameter so the input
 * survives page refreshes and back/forward navigation. Writes back with a
 * 300 ms debounce so the URL is not updated on every keystroke.
 *
 * Pressing `/` when no other focusable input is active focuses this bar,
 * matching the keyboard hint shown in the widget.
 */
function TopbarSearch() {
    const location = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()
    const initialQuery = searchParams.get('search') ?? ''
    const [draft, setDraft] = useState(initialQuery)
    const inputRef = useRef<HTMLInputElement>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const commit = useCallback((value: string) => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev)
                if (value) {
                    next.set('search', value)
                } else {
                    next.delete('search')
                }
                return next
            },
            {replace: true},
        )
    }, [setSearchParams])

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        setDraft(value)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => commit(value), 300)
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current)
                debounceRef.current = null
            }
            setDraft('')
            commit('')
            inputRef.current?.blur()
        }
    }

    /** Clean up pending debounce timer on unmount. */
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current)
                debounceRef.current = null
            }
        }
    }, [])

    /** Clear pending debounce and restore draft from destination URL search param on route change. */
    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current)
            debounceRef.current = null
        }
        const urlSearch = searchParams.get('search') ?? ''
        setDraft(urlSearch)
    }, [location.pathname])

    /** Focus on `/` when no other input/textarea/select is active. */
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== '/') return
            const tag = (event.target as HTMLElement).tagName
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
            event.preventDefault()
            inputRef.current?.focus()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    /** Keep local draft in sync if the param changes externally (e.g. nav, browser history). */
    useEffect(() => {
        const external = searchParams.get('search') ?? ''
        setDraft((prev) => {
            if (prev !== external) {
                if (debounceRef.current) {
                    clearTimeout(debounceRef.current)
                    debounceRef.current = null
                }
                return external
            }
            return prev
        })
    }, [searchParams])

    return (
        <div className="search">
            <Search size={14}/>
            <input
                ref={inputRef}
                value={draft}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Search services, features, docs, and more"
                aria-label="Search services, features, docs, and more"
            />
            <span className="kbd" aria-hidden="true">/</span>
        </div>
    )
}

function activeCloudFromPath(pathname: string): 'aws' | 'azure' | 'gcp' {
    const match = pathname.match(/^\/(?:cloud-explorer|console)\/(aws|azure|gcp)(?:\/|$)/)
    return (match?.[1] ?? 'aws') as 'aws' | 'azure' | 'gcp'
}

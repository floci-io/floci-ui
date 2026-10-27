import {NavLink, Outlet, useLocation, useSearchParams} from 'react-router-dom'
import {AlertTriangle, ChevronsLeft, ChevronsRight, LayoutDashboard, Search, Settings} from 'lucide-react'
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import flociWhite from '@/assets/floci-white.svg'
import flociBlack from '@/assets/floci-black.svg'
import flociMarkWhite from '@/assets/floci-mark-white.svg'
import flociMarkBlack from '@/assets/floci-mark-black.svg'
import {useTheme} from '@/lib/useTheme'
import {useSidebar} from '@/lib/useSidebar'
import {useActiveCloud} from '@/lib/useActiveCloud'
import {useQuery} from '@tanstack/react-query'
import {getCloudStatus} from '@/api/cloudProxyClient'
import {useCloudServicesQuery} from '@/api/queries/cloudQueries'
import {ThemeToggle} from '@/components/ThemeToggle'
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

function NavItem({to, icon, label, collapsed, state}: { to: string; icon: React.ElementType; label: string; collapsed: boolean; state?: {cloud: CloudProvider; fromCloudExplorer: boolean} }) {
    const Icon = icon
    return (
        <NavLink className="nav-link" to={to} state={state} title={collapsed ? label : undefined}>
            <Icon size={14} aria-hidden="true"/>
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
function CloudServiceNav({collapsed, cloud}: {collapsed: boolean; cloud: CloudProvider}) {
    const [searchParams] = useSearchParams()
    const search = (searchParams.get('search') ?? '').trim().toLowerCase()
    const cloudLabel = cloud.toUpperCase()
    const {data, isPending, isError, refetch, isFetching} = useCloudServicesQuery(cloud)

    if (isPending) return <CloudServiceNavSkeleton cloudLabel={cloudLabel}/>

    if (isError) {
        return (
            <div className="nav-section cloud-service-nav">
                <span className="nav-label">Cloud Services · {cloudLabel}</span>
                <div className="nav-link disabled nav-error">
                    <AlertTriangle size={14} aria-hidden="true"/>
                    <span>Services unavailable</span>
                </div>
                <button className="nav-retry" type="button" disabled={isFetching} onClick={() => void refetch()}>
                    {isFetching ? 'Retrying…' : 'Retry'}
                </button>
            </div>
        )
    }

    const allServices = data ?? []
    const filteredServices = search
        ? allServices.filter((s) =>
            s.displayName.toLowerCase().includes(search) ||
            s.description?.toLowerCase().includes(search) ||
            s.service.toLowerCase().includes(search) ||
            s.group.toLowerCase().includes(search)
          )
        : allServices

    const groups = groupByGroup(filteredServices)

    return (
        <div className="nav-section cloud-service-nav">
            <span className="nav-label">Cloud Services · {cloudLabel}</span>
            {filteredServices.length === 0 && search ? (
                <div className="nav-link disabled">
                    <span>No matching services</span>
                </div>
            ) : (
                groups.map(([group, services]) => (
                    <div className="nav-group" key={group}>
                        <span className="nav-group-label">{group}</span>
                        {services.map((service) => (
                            <CloudServiceNavItem key={service.service} cloud={cloud} service={service} collapsed={collapsed}/>
                        ))}
                    </div>
                ))
            )}
        </div>
    )
}

function CloudServiceNavItem({cloud, service, collapsed}: {cloud: CloudProvider; service: CloudServiceDescriptor; collapsed: boolean}) {
    const Icon = serviceIcon(service.iconKey)
    const reasonTitle = service.reason ? `${service.displayName} — ${service.reason}` : service.displayName

    if (service.availability === 'available') {
        const target = service.route.startsWith('/')
            ? service.route
            : `/cloud-explorer/${cloud}/${service.route}`
        return <NavItem to={target} icon={Icon} label={service.displayName} collapsed={collapsed}/>
    }

    // Title duplicates the visible label when the sidebar is expanded, which WAVE
    // flags as redundant. Keep it on the rail, where the label is hidden.
    return (
        <div
            className="nav-link disabled"
            title={collapsed || service.reason ? reasonTitle : undefined}
        >
            <Icon size={14} aria-hidden="true"/>
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
    const activeCloud = useActiveCloud()
    const {resolvedTheme} = useTheme()
    const {collapsed, toggle: toggleSidebar, toggleRef} = useSidebar()
    const isDark = resolvedTheme === 'dark'
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
            <a className="skip-link" href="#main-content">Skip to content</a>
            <aside className="sidebar">
                <div className="sidebar-inner">
                    <div className="brand">
                        <img className="brand-logo" src={isDark ? flociWhite : flociBlack} alt="Floci"/>
                        <img className="brand-mark" src={isDark ? flociMarkWhite : flociMarkBlack} alt="" aria-hidden="true"/>
                        <p>Any Cloud. Locally.</p>
                    </div>

                    <nav className="nav" aria-label="Console">
                        <div className="nav-section">
                            <span className="nav-label">General</span>
                            <NavItem to={`/console/${activeCloud}`} icon={LayoutDashboard} label="Console Home" collapsed={collapsed}/>
                            <NavItem
                                to="/settings"
                                icon={Settings}
                                label="Settings"
                                collapsed={collapsed}
                                state={{cloud: activeCloud, fromCloudExplorer: location.pathname.startsWith('/cloud-explorer/') || location.state?.fromCloudExplorer === true}}
                            />
                        </div>
                        <CloudServiceNav collapsed={collapsed} cloud={activeCloud}/>
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
                    <ThemeToggle/>
                    <div id="topbar-status" className="topbar-status"/>
                    <div
                        className={`connection ${isConnected ? 'connected' : 'disconnected'}`}
                        title={`${connectionLabel} — ${connectionTarget}`}
                    >
                        <span className={connectionDotClass(status)} aria-hidden="true"/>
                        <span className="connection-state">{connectionLabel}</span>
                        <span className="connection-target">{connectionTarget}</span>
                    </div>
                </header>
                <main id="main-content" className="main" tabIndex={-1}>
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
 * Pressing Escape clears the query and blurs the input.
 */
export function TopbarSearch() {
    const location = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()
    const initialQuery = searchParams.get('search') ?? ''
    const [draft, setDraft] = useState(initialQuery)
    const inputRef = useRef<HTMLInputElement>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingRef = useRef<{value: string; pathname: string; search: string; ready: boolean} | null>(null)

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
            {replace: true, state: location.state},
        )
    }, [setSearchParams, location.state])

    // A transition can update window.location before the rendered route commits.
    const committedRef = useRef({location, commit})
    useLayoutEffect(() => {
        committedRef.current = {location, commit}
    }, [location, commit])

    const scheduleCommit = (value: string, delay: number) => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        const pending = {
            value,
            pathname: window.location.pathname,
            search: window.location.search,
            ready: false,
        }
        pendingRef.current = pending
        const flush = () => {
            if (pendingRef.current !== pending) return
            debounceRef.current = null
            const rendered = committedRef.current.location
            if (rendered.pathname === pending.pathname && rendered.search === pending.search) {
                pendingRef.current = null
                committedRef.current.commit(value)
            } else if (window.location.pathname === pending.pathname && window.location.search === pending.search) {
                pending.ready = true
            } else {
                pendingRef.current = null
            }
        }
        if (delay === 0) flush()
        else debounceRef.current = setTimeout(flush, delay)
    }

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        setDraft(value)
        scheduleCommit(value, 300)
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            setDraft('')
            scheduleCommit('', 0)
            inputRef.current?.blur()
        }
    }

    /** Clean up pending debounce timer on unmount. */
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
            debounceRef.current = null
            pendingRef.current = null
        }
    }, [])

    /** Keep the draft until its destination commits; cancel it for any other navigation. */
    useEffect(() => {
        const pending = pendingRef.current
        if (pending && pending.pathname === location.pathname && pending.search === location.search) {
            if (pending.ready) {
                pendingRef.current = null
                committedRef.current.commit(pending.value)
            }
            return
        }
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = null
        pendingRef.current = null
        setDraft(new URLSearchParams(location.search).get('search') ?? '')
    }, [location])

    /** Back can cancel a suspended navigation without changing the rendered location. */
    useEffect(() => {
        const onPopState = () => {
            const pending = pendingRef.current
            if (!pending || (window.location.pathname === pending.pathname && window.location.search === pending.search)) return
            if (debounceRef.current) clearTimeout(debounceRef.current)
            debounceRef.current = null
            pendingRef.current = null
            setDraft(new URLSearchParams(window.location.search).get('search') ?? '')
        }
        window.addEventListener('popstate', onPopState)
        return () => window.removeEventListener('popstate', onPopState)
    }, [])
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


    return (
        <div className="search">
            <Search size={14} aria-hidden="true"/>
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

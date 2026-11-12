import {NavLink, Outlet, useLocation, useMatch, useSearchParams} from 'react-router-dom'
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
import {Button} from '@/components/sodium/ui/button'
import {Status} from '@/components/sodium/ui/status'
import {Input} from '@/components/sodium/ui/input'
import {AppBreadcrumbs} from '@/components/AppBreadcrumbs'
import {ScrollArea} from '@/components/ScrollArea'
import {Skeleton} from '@/components/sodium/ui/skeleton'
import {Tag} from '@/components/sodium/ui/tag'
import {ChevronLeft, ChevronRight, Icon, Meter, Settings, WarningAlt, type SodiumIcon} from '@/components/sodium/icon'
import {cn} from '@/lib/sodium/utils'
import {serviceIcon} from '@/components/serviceIcons'
import type {CloudProvider, CloudServiceDescriptor, RuntimeReachability} from '@/types/cloud'
import {Hint} from '@/components/Hint'

/** The runtime's reachability, plus the state before the status query answers. */
type ConnectionStatus = RuntimeReachability | 'unknown'

/**
 * Only a definitive answer gets an outcome colour.
 *
 * `unknown` (status query still in flight, which is first paint and every cloud switch)
 * and `coming_soon` (runtime not wired) stay `idle`. Mapping anything that is not
 * `reachable` to a failure made the mark flash ok, fail, ok on each switch.
 */
function connectionStatus(status: ConnectionStatus): 'ok' | 'fail' | 'idle' {
    if (status === 'reachable') return 'ok'
    if (status === 'unavailable') return 'fail'
    return 'idle'
}

const NAV_ROW = 'flex h-8 items-center gap-2 px-3 type-label-sm text-text-2 hover:bg-hover hover:text-text-1'
const NAV_GROUP_LABEL = 'sidebar-label block px-3 pb-1 pt-3 type-micro text-text-3'
const NAV_SECTION_LABEL = 'sidebar-label block px-3 pb-1 pt-4 type-micro text-text-3'

/** Matches today's service count, so the real nav causes no layout jump. */
const SKELETON_ROWS = 7

function NavItem({to, icon, label, collapsed, state}: { to: string; icon: SodiumIcon; label: string; collapsed: boolean; state?: {cloud: CloudProvider; fromCloudExplorer: boolean} }) {
    // Decided here, not by NavLink's className function: the tooltip's render prop merges plain class strings only.
    const active = useMatch({path: to.split('?')[0], end: false}) !== null
    return (
        <Hint label={label} side="right" disabled={!collapsed}>
            <NavLink
                className={cn(NAV_ROW, active && 'selected text-text-1')}
                to={to}
                state={state}
            >
                <Icon icon={icon}/>
                <span className="sidebar-fade truncate">{label}</span>
            </NavLink>
        </Hint>
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
            <div className="cloud-service-nav">
                <span className={NAV_SECTION_LABEL}>Cloud services · {cloudLabel}</span>
                <div className={cn(NAV_ROW, 'text-fail-text')} aria-disabled="true">
                    <Icon icon={WarningAlt}/>
                    <span>Services unavailable</span>
                </div>
                <Button variant="secondary" size="sm" className="mx-3 mt-2" disabled={isFetching} onClick={() => void refetch()}>
                    {isFetching ? 'Retrying…' : 'Retry'}
                </Button>
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
        <div className="cloud-service-nav">
            <span className={NAV_SECTION_LABEL}>Cloud services · {cloudLabel}</span>
            {filteredServices.length === 0 && search ? (
                <div className={cn(NAV_ROW, 'text-text-3')} aria-disabled="true">
                    <span>No matching services</span>
                </div>
            ) : (
                groups.map(([group, services]) => (
                    <div key={group} className="sidebar-group">
                        <span className={NAV_GROUP_LABEL}>{group}</span>
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
    const glyph = serviceIcon(service.iconKey)
    const reasonTitle = service.reason ? `${service.displayName}, ${service.reason}` : service.displayName

    if (service.availability === 'available') {
        const target = service.route.startsWith('/')
            ? service.route
            : `/cloud-explorer/${cloud}/${service.route}`
        return <NavItem to={target} icon={glyph} label={service.displayName} collapsed={collapsed}/>
    }

    // The label is already visible when the sidebar is open, so the tooltip only speaks on the rail or to say why.
    return (
        <Hint label={reasonTitle} side="right" disabled={!collapsed && !service.reason}>
            <div
                className={cn(NAV_ROW, 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled')}
                aria-disabled="true"
                tabIndex={0}
            >
                <Icon icon={glyph}/>
                <span className="sidebar-fade truncate">{service.displayName}</span>
                <Tag size="sm" variant="outline" className="sidebar-fade ms-auto">Soon</Tag>
            </div>
        </Hint>
    )
}

function CloudServiceNavSkeleton({cloudLabel}: {cloudLabel: string}) {
    return (
        <div className="cloud-service-nav">
            <span className={NAV_SECTION_LABEL}>Cloud services · {cloudLabel}</span>
            {Array.from({length: SKELETON_ROWS}, (_, index) => (
                <div className="flex h-8 items-center px-3" key={index} aria-hidden="true">
                    <Skeleton className="h-3 w-full"/>
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
        <div className="flex h-full min-h-0">
            <a className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-panel focus:px-3 focus:py-2 type-label-sm" href="#main-content">Skip to content</a>
            <aside className="sidebar-shell flex h-full shrink-0 flex-col overflow-hidden border-e border-line bg-panel" data-collapsed={collapsed ? '' : undefined}>
                <div className="relative flex h-14 shrink-0 items-center border-b border-line px-3">
                    <img className="sidebar-logo-full h-5" src={isDark ? flociWhite : flociBlack} alt="Floci"/>
                    <img className="sidebar-logo-mark h-5" src={isDark ? flociMarkWhite : flociMarkBlack} alt="" aria-hidden="true"/>
                </div>

                <ScrollArea as="nav" aria-label="Console" wrapperClassName="flex-1" className="pb-2">
                    <div className="sidebar-group">
                        <span className={NAV_SECTION_LABEL}>General</span>
                        <NavItem to={`/console/${activeCloud}`} icon={Meter} label="Console Home" collapsed={collapsed}/>
                        <NavItem
                            to="/settings"
                            icon={Settings}
                            label="Settings"
                            collapsed={collapsed}
                            state={{cloud: activeCloud, fromCloudExplorer: location.pathname.startsWith('/cloud-explorer/') || location.state?.fromCloudExplorer === true}}
                        />
                    </div>
                    <CloudServiceNav collapsed={collapsed} cloud={activeCloud}/>
                </ScrollArea>

                <div className="sidebar-footer flex h-10 shrink-0 items-center justify-between border-t border-line ps-3 pe-1">
                    <span className="sidebar-footer-text type-micro text-text-3">Floci DevTools · Local</span>
                    <Hint label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Button
                        ref={toggleRef}
                        variant="ghost"
                        size="sm"
                        onClick={toggleSidebar}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {collapsed ? <Icon icon={ChevronRight}/> : <Icon icon={ChevronLeft}/>}
                    </Button></Hint>
                </div>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-page px-4">
                    <TopbarSearch/>
                    <ThemeToggle/>
                    <div
                        className="ms-auto flex items-center gap-3"
                        title={`${connectionLabel}, ${connectionTarget}`}
                    >
                        <div id="topbar-status" className="flex items-center gap-2 empty:hidden"/>
                        <span className="shrink-0 whitespace-nowrap"><Status status={connectionStatus(status)}>{connectionLabel}</Status></span>
                        <span className="type-code hidden truncate text-text-2 xl:inline">{connectionTarget}</span>
                    </div>
                </header>
                <AppBreadcrumbs/>
                <ScrollArea as="main" id="main-content" tabIndex={-1} wrapperClassName="flex-1">
                    <div key={location.pathname} className="page-enter min-h-full">
                        <Outlet/>
                    </div>
                </ScrollArea>
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

    const handleChange = (value: string) => {
        setDraft(value)
        scheduleCommit(value, value === '' ? 0 : 300)
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

    return (
        <Input
            ref={inputRef}
            mode="search"
            shortcut="/"
            className="w-full max-w-md"
            value={draft}
            onValueChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Search services, features, docs, and more"
            aria-label="Search services, features, docs, and more"
        />
    )
}

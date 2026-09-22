import {NavLink, Outlet, useLocation, useNavigate, useSearchParams} from 'react-router-dom'
import {AlertTriangle, ChevronsLeft, ChevronsRight, LayoutDashboard, Moon, Search, Sun} from 'lucide-react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
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

function NavItem({to, icon, label, collapsed}: { to: string; icon: React.ElementType; label: string; collapsed: boolean }) {
    const Icon = icon
    return (
        <NavLink className="nav-link" to={to} title={collapsed ? label : undefined}>
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
function CloudServiceNav({collapsed}: {collapsed: boolean}) {
    const location = useLocation()
    const [searchParams] = useSearchParams()
    const search = (searchParams.get('search') ?? '').trim().toLowerCase()
    const cloud = activeCloudFromPath(location.pathname)
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
            <a className="skip-link" href="#main-content">Skip to content</a>
            <aside className="sidebar">
                <div className="sidebar-inner">
                    <div className="brand">
                        <img className="brand-logo" src={isDark ? flociWhite : flociBlack} alt="Floci"/>
                        <img className="brand-mark" src={isDark ? flociMarkWhite : flociMarkBlack} alt="" aria-hidden="true"/>
                        <p>Local Cloud</p>
                    </div>

                    <nav className="nav" aria-label="Console">
                        <div className="nav-section">
                            <span className="nav-label">General</span>
                            <NavItem to={`/console/${activeCloud}`} icon={LayoutDashboard} label="Console Home" collapsed={collapsed}/>
                        </div>
                        <CloudServiceNav collapsed={collapsed}/>
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
                    <TopbarSearch cloud={activeCloud}/>
                    <button
                        className="icon-btn"
                        type="button"
                        onClick={toggle}
                        title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                    >
                        {isDark ? <Sun size={14} aria-hidden="true"/> : <Moon size={14} aria-hidden="true"/>}
                    </button>
                    <div id="topbar-status" className="topbar-status"/>
                    <AccountSwitcher/>
                    <div className={`connection ${isConnected ? 'connected' : 'disconnected'}`}>
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

interface SearchSuggestion {
    id: string
    label: string
    route: string
    icon: React.ElementType
}

/**
 * Topbar search bar.
 *
 * Reads the initial value from the `search` URL query parameter so the input
 * survives page refreshes and back/forward navigation. Writes back with a
 * 300 ms debounce so the URL is not updated on every keystroke — this part
 * still drives the sidebar's own inline filter (`CloudServiceNav`).
 *
 * On top of that, typing also opens a live autocomplete dropdown of matching
 * items from the active cloud's sidebar menu (Console Home + its services),
 * for jumping straight to one without scrolling the sidebar. It's a combobox,
 * not a menu popover: focus never leaves the input, arrow keys only move the
 * `aria-activedescendant` highlight, so there's no focus to lose track of.
 *
 * Pressing `/` when no other focusable input is active, or Cmd/Ctrl+K from
 * anywhere, focuses this bar — the latter also selects existing text so
 * typing replaces it, matching the hint shown in the widget.
 * Pressing Escape clears the query, closes the dropdown, and blurs the input.
 */
function TopbarSearch({cloud}: {cloud: CloudProvider}) {
    const location = useLocation()
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const initialQuery = searchParams.get('search') ?? ''
    const [draft, setDraft] = useState(initialQuery)
    const [suggestOpen, setSuggestOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const servicesQuery = useCloudServicesQuery(cloud)

    const suggestions = useMemo<SearchSuggestion[]>(() => {
        const query = draft.trim().toLowerCase()
        if (!query) return []
        const items: SearchSuggestion[] = [
            {id: 'console-home', label: 'Console Home', route: `/console/${cloud}`, icon: LayoutDashboard},
            ...(servicesQuery.data ?? [])
                .filter((service) => service.availability === 'available')
                .map((service): SearchSuggestion => ({
                    id: service.service,
                    label: service.displayName,
                    route: service.route.startsWith('/') ? service.route : `/cloud-explorer/${cloud}/${service.route}`,
                    icon: serviceIcon(service.iconKey),
                })),
        ]
        return items.filter((item) => item.label.toLowerCase().includes(query))
    }, [draft, cloud, servicesQuery.data])

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

    function goTo(item: SearchSuggestion) {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current)
            debounceRef.current = null
        }
        setDraft('')
        commit('')
        setSuggestOpen(false)
        inputRef.current?.blur()
        navigate(item.route)
    }

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        setDraft(value)
        setSuggestOpen(Boolean(value.trim()))
        setHighlightedIndex(0)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => commit(value), 300)
    }

    const handleFocus = () => {
        if (draft.trim()) setSuggestOpen(true)
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current)
                debounceRef.current = null
            }
            setDraft('')
            commit('')
            setSuggestOpen(false)
            inputRef.current?.blur()
            return
        }

        if (!suggestOpen || suggestions.length === 0) return

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlightedIndex((index) => (index + 1) % suggestions.length)
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlightedIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
        } else if (event.key === 'Enter') {
            event.preventDefault()
            goTo(suggestions[highlightedIndex])
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
        setSuggestOpen(false)
    }, [location.pathname])

    /** Close the dropdown on an outside click, same pattern as the header switchers. */
    useEffect(() => {
        if (!suggestOpen) return
        const onClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setSuggestOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [suggestOpen])

    /**
     * Focus on `/` when no other input/textarea/select is active, or on
     * Cmd/Ctrl+K unconditionally — the modifier makes it safe to steal focus
     * even while another field is focused, unlike bare `/`.
     */
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault()
                inputRef.current?.focus()
                inputRef.current?.select()
                return
            }
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

    const showSuggestions = suggestOpen && suggestions.length > 0

    return (
        <div className="search" ref={containerRef}>
            <Search size={14} aria-hidden="true"/>
            <input
                ref={inputRef}
                role="combobox"
                aria-expanded={showSuggestions}
                aria-controls="topbar-search-suggestions"
                aria-autocomplete="list"
                aria-activedescendant={showSuggestions ? `search-suggestion-${highlightedIndex}` : undefined}
                value={draft}
                onChange={handleChange}
                onFocus={handleFocus}
                onKeyDown={handleKeyDown}
                placeholder="Search services, features, docs, and more"
                aria-label="Search services, features, docs, and more"
            />
            <span className="kbd" aria-hidden="true">⌘K</span>

            {showSuggestions && (
                <div className="account-popover search-suggestions" role="listbox" id="topbar-search-suggestions">
                    <div className="account-popover-title">Jump to</div>
                    <div className="account-recents">
                        {suggestions.map((item, index) => {
                            const Icon = item.icon
                            return (
                                <button
                                    key={item.id}
                                    id={`search-suggestion-${index}`}
                                    type="button"
                                    className={`account-option${index === highlightedIndex ? ' active' : ''}`}
                                    role="option"
                                    aria-selected={index === highlightedIndex}
                                    onMouseEnter={() => setHighlightedIndex(index)}
                                    onClick={() => goTo(item)}
                                >
                                    <Icon size={14}/>
                                    <span className="account-option-id">{item.label}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}

function activeCloudFromPath(pathname: string): 'aws' | 'azure' | 'gcp' {
    const match = pathname.match(/^\/(?:cloud-explorer|console)\/(aws|azure|gcp)(?:\/|$)/)
    return (match?.[1] ?? 'aws') as 'aws' | 'azure' | 'gcp'
}

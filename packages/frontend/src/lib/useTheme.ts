import {useEffect, useSyncExternalStore} from 'react'
import {create} from 'zustand'

type Theme = 'dark' | 'light' | 'system'

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
    return window.matchMedia?.(SYSTEM_DARK_QUERY).matches ?? false
}

function subscribeToSystemTheme(onChange: () => void): () => void {
    const query = window.matchMedia?.(SYSTEM_DARK_QUERY)
    if (!query) return () => {}

    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
}

const useThemeStore = create<{
    theme: Theme
    setTheme: (theme: Theme) => void
}>()((set) => ({
    theme: (() => {
        const stored = localStorage.getItem('floci-theme')
        return stored === 'light' || stored === 'system' ? stored : 'dark'
    })(),
    setTheme: (theme) => set({theme}),
}))

/** Subscribe to theme changes and apply to DOM + localStorage. */
export function useTheme() {
    const theme = useThemeStore((s) => s.theme)
    const setTheme = useThemeStore((s) => s.setTheme)
    const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark)
    const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', resolvedTheme)
        localStorage.setItem('floci-theme', theme)
    }, [resolvedTheme, theme])

    const toggle = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')

    return {theme, resolvedTheme, setTheme, toggle}
}

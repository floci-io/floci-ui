import {useEffect} from 'react'
import {create} from 'zustand'

type Theme = 'dark' | 'light'

const useThemeStore = create<{
    theme: Theme
    setTheme: (theme: Theme) => void
}>()((set) => ({
    theme: (localStorage.getItem('floci-theme') === 'light' ? 'light' : 'dark') as Theme,
    setTheme: (theme) => set({theme}),
}))

/** Subscribe to theme changes and apply to DOM + localStorage. */
export function useTheme() {
    const theme = useThemeStore((s) => s.theme)
    const setTheme = useThemeStore((s) => s.setTheme)

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
        localStorage.setItem('floci-theme', theme)
    }, [theme])

    return {theme, setTheme}
}

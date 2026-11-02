import {Icon, Moon, Sun, Monitor} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {THEME_ORDER, useTheme, type Theme} from '@/lib/useTheme'
import {Hint} from '@/components/Hint'

const THEME_META: Record<Theme, {label: string}> = {
    dark: {label: 'Dark'},
    light: {label: 'Light'},
    system: {label: 'System'},
}

/**
 * Top-bar theme button: one icon that cross-fades into the next (transitions.dev icon swap). It shows the same
 * three-way setting as Settings, Appearance (shared store) and each click moves to the next option: Dark,
 * Light, System.
 */
export function ThemeToggle() {
    const {theme, cycle} = useTheme()
    const {label} = THEME_META[theme]
    const next = THEME_META[THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]].label
    return (
        <Hint label={`Theme: ${label}. Switch to ${next}.`}><Button variant="ghost"
            size="icon"
            type="button"
            onClick={cycle}
            aria-label={`Theme: ${label}`}
        >
            <span className="t-icon-swap" data-state={theme}>
                <span className="t-icon" data-icon="dark"><Icon icon={Moon}/></span>
                <span className="t-icon" data-icon="light"><Icon icon={Sun}/></span>
                <span className="t-icon" data-icon="system"><Icon icon={Monitor}/></span>
            </span>
        </Button></Hint>
    )
}

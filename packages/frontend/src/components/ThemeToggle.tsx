import {Monitor, Moon, Sun} from 'lucide-react'
import {THEME_ORDER, useTheme, type Theme} from '@/lib/useTheme'

const THEME_META: Record<Theme, {label: string; icon: typeof Sun}> = {
    dark: {label: 'Dark', icon: Moon},
    light: {label: 'Light', icon: Sun},
    system: {label: 'System', icon: Monitor},
}

/**
 * Top-bar theme button: an icon at rest that opens to its label and current value on
 * hover or keyboard focus. It shows the same three-way setting as Settings → Appearance
 * (shared store) and each click moves to the next option: Dark, Light, System.
 */
export function ThemeToggle() {
    const {theme, cycle} = useTheme()
    const {label, icon: Icon} = THEME_META[theme]
    const next = THEME_META[THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]].label
    return (
        <button
            className="theme-toggle"
            type="button"
            onClick={cycle}
            title={`Theme: ${label}. Switch to ${next}.`}
            aria-label={`Theme: ${label}`}
        >
            <Icon size={14} aria-hidden="true"/>
            <span className="theme-toggle-label">
                <span>
                    <span className="theme-toggle-key">Theme</span>
                    <span className="theme-toggle-value">{label}</span>
                </span>
            </span>
        </button>
    )
}

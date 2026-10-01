import {Moon, Sun} from 'lucide-react'
import {useTheme} from '@/lib/useTheme'

/** One-click light/dark switch for the top bar; Settings → Appearance shares the same store. */
export function ThemeToggle() {
    const {theme, toggle} = useTheme()
    const isDark = theme === 'dark'
    // A toggle keeps a stable accessible name and lets aria-pressed carry the
    // state; the tooltip still describes the action for pointer users.
    return (
        <button
            className="icon-btn"
            type="button"
            onClick={toggle}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Dark theme"
            aria-pressed={isDark}
        >
            {isDark ? <Sun size={14} aria-hidden="true"/> : <Moon size={14} aria-hidden="true"/>}
        </button>
    )
}

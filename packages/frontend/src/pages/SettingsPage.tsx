import {Settings} from 'lucide-react'
import {useTheme} from '@/lib/useTheme'

export function SettingsPage() {
    const {theme, setTheme} = useTheme()

    return (
        <>
            <div className="page-header">
                <div className="page-title">
                    <Settings size={20}/>
                    <div>
                        <h2>Settings</h2>
                        <p className="muted">Application preferences</p>
                    </div>
                </div>
            </div>
            <div className="content">
                <div className="settings-section">
                    <h3>Appearance</h3>
                    <div className="settings-row">
                        <div className="settings-row-text">
                            <span className="settings-label">Theme</span>
                            <span className="settings-description">Switch between light and dark mode</span>
                        </div>
                        <div className="settings-toggle-group" role="radiogroup" aria-label="Theme">
                            <button
                                type="button"
                                className={`settings-toggle-btn${theme === 'dark' ? ' active' : ''}`}
                                role="radio"
                                aria-checked={theme === 'dark'}
                                onClick={() => setTheme('dark')}
                            >
                                Dark
                            </button>
                            <button
                                type="button"
                                className={`settings-toggle-btn${theme === 'light' ? ' active' : ''}`}
                                role="radio"
                                aria-checked={theme === 'light'}
                                onClick={() => setTheme('light')}
                            >
                                Light
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

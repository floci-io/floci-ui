import {Settings} from 'lucide-react'
import {useLocation, useNavigate} from 'react-router-dom'
import {AccountSwitcher} from '@/components/AccountSwitcher'
import {CloudSwitcher} from '@/components/CloudSwitcher'
import {useCloudsQuery} from '@/api/queries/cloudQueries'
import {useActiveCloud} from '@/lib/useActiveCloud'
import {useTheme} from '@/lib/useTheme'
import type {CloudProvider} from '@/types/cloud'

export function SettingsPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const fromCloudExplorer = (location.state as {fromCloudExplorer?: boolean} | null)?.fromCloudExplorer === true
    const cloud = useActiveCloud()
    const cloudsQuery = useCloudsQuery()
    const {theme, setTheme} = useTheme()

    function selectCloud(nextCloud: CloudProvider) {
        navigate(fromCloudExplorer ? `/cloud-explorer/${nextCloud}/storage` : `/console/${nextCloud}`)
    }

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
                <section className="settings-section">
                    <h3>Environment</h3>
                    <div className="settings-row">
                        <div className="settings-row-text">
                            <span className="settings-label">Cloud</span>
                            <span className="settings-description">Current cloud environment</span>
                        </div>
                        <CloudSwitcher
                            clouds={cloudsQuery.data ?? []}
                            selected={cloud}
                            onSelect={selectCloud}
                        />
                    </div>
                    <div className="settings-row">
                        <div className="settings-row-text">
                            <span className="settings-label">Account</span>
                            <span className="settings-description">Account used for scoped resources</span>
                        </div>
                        <AccountSwitcher/>
                    </div>
                </section>
                <div className="settings-section">
                    <h3>Appearance</h3>
                    <div className="settings-row">
                        <div className="settings-row-text">
                            <span className="settings-label">Theme</span>
                            <span className="settings-description">Choose light, dark, or your system preference</span>
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
                            <button
                                type="button"
                                className={`settings-toggle-btn${theme === 'system' ? ' active' : ''}`}
                                role="radio"
                                aria-checked={theme === 'system'}
                                onClick={() => setTheme('system')}
                            >
                                System
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

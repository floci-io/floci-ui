import type {ReactNode} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'
import {AccountSwitcher} from '@/components/AccountSwitcher'
import {CloudSwitcher} from '@/components/CloudSwitcher'
import {Frame, FrameBody, FrameHeader, FrameTitle} from '@/components/sodium/ui/frame'
import {SegmentedControl, SegmentedControlItem} from '@/components/sodium/ui/segmented-control'
import {useCloudsQuery} from '@/api/queries/cloudQueries'
import {useActiveCloud} from '@/lib/useActiveCloud'
import {useTheme, type Theme} from '@/lib/useTheme'
import type {CloudProvider} from '@/types/cloud'
import {PageHeader} from '@/components/PageHeader'

function SettingRow({label, description, children}: {label: string; description: string; children: ReactNode}) {
    return (
        <div className="rule-row flex items-start justify-between gap-4 px-inset py-3">
            <div className="min-w-0">
                <p className="type-body-sm text-text-1">{label}</p>
                <p className="type-body-sm text-text-2">{description}</p>
            </div>
            {children}
        </div>
    )
}

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
            <PageHeader title="Settings" description="Application preferences"/>
            <div className="flex flex-col gap-4 p-4">

            <Frame aria-label="Environment">
                <FrameHeader><FrameTitle>Environment</FrameTitle></FrameHeader>
                <FrameBody padding="none">
                    <SettingRow label="Cloud" description="Current cloud environment">
                        <CloudSwitcher clouds={cloudsQuery.data ?? []} selected={cloud} onSelect={selectCloud}/>
                    </SettingRow>
                    <SettingRow label="Account" description="Account used for scoped resources">
                        <AccountSwitcher/>
                    </SettingRow>
                </FrameBody>
            </Frame>

            <Frame aria-label="Appearance">
                <FrameHeader><FrameTitle>Appearance</FrameTitle></FrameHeader>
                <FrameBody padding="none">
                    <SettingRow label="Theme" description="Choose light, dark, or your system preference">
                        <SegmentedControl
                            aria-label="Theme"
                            value={theme}
                            onValueChange={(next) => setTheme(next as Theme)}
                        >
                            <SegmentedControlItem value="dark">Dark</SegmentedControlItem>
                            <SegmentedControlItem value="light">Light</SegmentedControlItem>
                            <SegmentedControlItem value="system">System</SegmentedControlItem>
                        </SegmentedControl>
                    </SettingRow>
                </FrameBody>
            </Frame>
            </div>
        </>
    )
}

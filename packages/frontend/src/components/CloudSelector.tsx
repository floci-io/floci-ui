import type {CloudDescriptor, CloudProvider} from '@/types/cloud'

interface CloudSelectorProps {
    clouds: CloudDescriptor[]
    selected: CloudProvider
    onSelect: (cloud: CloudProvider) => void
}

export function CloudSelector({clouds, selected, onSelect}: CloudSelectorProps) {
    return (
        <div className="cloud-selector" role="group" aria-label="Cloud provider">
            {clouds.map((cloud) => (
                <button
                    key={cloud.id}
                    className={`selector-pill ${selected === cloud.id ? 'active' : ''} ${cloud.availability === 'coming_soon' ? 'soon' : ''}`}
                    onClick={() => onSelect(cloud.id)}
                    type="button"
                >
                    <span>{cloud.displayName}</span>
                    {cloud.availability === 'coming_soon' && <span className="badge neutral">Soon</span>}
                </button>
            ))}
        </div>
    )
}

import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/sodium/ui/select'
import {Tag} from '@/components/sodium/ui/tag'
import type {CloudDescriptor, CloudProvider} from '@/types/cloud'

interface CloudSwitcherProps {
    clouds: CloudDescriptor[]
    selected: CloudProvider
    onSelect: (cloud: CloudProvider) => void
}

function cloudLabel(cloud: CloudDescriptor) {
    return cloud.availability === 'coming_soon'
        ? <span className="flex items-center gap-2">{cloud.displayName}<Tag size="sm" variant="outline">Soon</Tag></span>
        : cloud.displayName
}

/** Cloud provider picker. The selected cloud stays listed while the cloud list is still loading. */
export function CloudSwitcher({clouds, selected, onSelect}: CloudSwitcherProps) {
    const options = clouds.some((cloud) => cloud.id === selected)
        ? clouds
        : [...clouds, {id: selected, displayName: selected.toUpperCase(), availability: 'available' as const}]
    const items = options.map((cloud) => ({value: cloud.id, label: cloudLabel(cloud)}))

    return (
        <Select
            items={items}
            value={selected}
            onValueChange={(next) => {
                if (next && next !== selected) onSelect(next as CloudProvider)
            }}
        >
            <SelectTrigger aria-label="Cloud" className="w-56">
                <SelectValue/>
            </SelectTrigger>
            <SelectContent>
                {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

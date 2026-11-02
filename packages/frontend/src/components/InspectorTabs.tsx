import {Tabs, TabsList, TabsTrigger} from '@/components/sodium/ui/tabs'

export type InspectorTab = 'plain' | 'json' | 'table'

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'plain', label: 'Plain Text' },
  { id: 'json', label: 'JSON' },
  { id: 'table', label: 'Table' },
]

interface InspectorTabsProps {
  idPrefix: string
  activeTab: InspectorTab
  onChange: (tab: InspectorTab) => void
}

export function InspectorTabs({ idPrefix, activeTab, onChange }: InspectorTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={(next) => onChange(next as InspectorTab)}>
      <TabsList aria-label="Metadata views" activateOnFocus>
        {TABS.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            id={`${idPrefix}-tab-${tab.id}`}
            aria-controls={`${idPrefix}-tabpanel-${tab.id}`}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

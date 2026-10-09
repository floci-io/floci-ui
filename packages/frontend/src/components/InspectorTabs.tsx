import type { KeyboardEvent } from 'react'

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
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = TABS.findIndex((tab) => tab.id === activeTab)
    let next: number
    if (event.key === 'ArrowRight') next = (current + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    onChange(TABS[next].id)
    document.getElementById(`${idPrefix}-tab-${TABS[next].id}`)?.focus()
  }

  return (
    <div className="drawer-tabs" role="tablist" aria-label="Metadata views" onKeyDown={handleKeyDown}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`drawer-tab ${activeTab === tab.id ? 'active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`${idPrefix}-tabpanel-${tab.id}`}
          id={`${idPrefix}-tab-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

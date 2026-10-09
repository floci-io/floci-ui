import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {useState} from 'react'
import {describe, expect, test} from 'vitest'
import {InspectorTabs, type InspectorTab} from './InspectorTabs'

function Harness() {
    const [tab, setTab] = useState<InspectorTab>('plain')
    return <InspectorTabs idPrefix="t" activeTab={tab} onChange={setTab}/>
}

describe('InspectorTabs keyboard navigation', () => {
    test('only the selected tab is a tab stop', () => {
        render(<Harness/>)
        expect(screen.getByRole('tab', {name: 'Plain Text'})).toHaveAttribute('tabindex', '0')
        expect(screen.getByRole('tab', {name: 'JSON'})).toHaveAttribute('tabindex', '-1')
        expect(screen.getByRole('tab', {name: 'Table'})).toHaveAttribute('tabindex', '-1')
    })

    test('arrows move focus and selection, wrapping at the ends', async () => {
        const user = userEvent.setup()
        render(<Harness/>)
        screen.getByRole('tab', {name: 'Plain Text'}).focus()

        await user.keyboard('{ArrowRight}')
        expect(screen.getByRole('tab', {name: 'JSON'})).toHaveFocus()
        expect(screen.getByRole('tab', {name: 'JSON'})).toHaveAttribute('aria-selected', 'true')

        await user.keyboard('{ArrowRight}{ArrowRight}')
        expect(screen.getByRole('tab', {name: 'Plain Text'})).toHaveFocus()

        await user.keyboard('{ArrowLeft}')
        expect(screen.getByRole('tab', {name: 'Table'})).toHaveFocus()
        expect(screen.getByRole('tab', {name: 'Table'})).toHaveAttribute('aria-selected', 'true')
    })

    test('Home and End jump to the first and last tab', async () => {
        const user = userEvent.setup()
        render(<Harness/>)
        screen.getByRole('tab', {name: 'Plain Text'}).focus()

        await user.keyboard('{End}')
        expect(screen.getByRole('tab', {name: 'Table'})).toHaveFocus()

        await user.keyboard('{Home}')
        expect(screen.getByRole('tab', {name: 'Plain Text'})).toHaveFocus()
        expect(screen.getByRole('tab', {name: 'Plain Text'})).toHaveAttribute('aria-selected', 'true')
    })
})

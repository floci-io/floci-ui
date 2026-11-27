import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe, expect, it, vi} from 'vitest'
import type {CloudDescriptor, CloudProvider} from '@/types/cloud'
import {CloudSwitcher} from './CloudSwitcher'

const CLOUDS: CloudDescriptor[] = [
    {id: 'aws', displayName: 'AWS', availability: 'available'},
    {id: 'azure', displayName: 'Azure', availability: 'available'},
    {id: 'gcp', displayName: 'GCP', availability: 'available'},
    {id: 'oci', displayName: 'OCI', availability: 'available'},
]

function renderSwitcher(selected: CloudProvider = 'aws') {
    const onSelect = vi.fn()
    render(<CloudSwitcher clouds={CLOUDS} selected={selected} onSelect={onSelect}/>)
    return onSelect
}

async function openSwitcher(user: ReturnType<typeof userEvent.setup>, current = 'AWS') {
    await user.click(screen.getByRole('button', {name: `Switch cloud, currently ${current}`}))
    return screen.getByRole('listbox', {name: 'Clouds'})
}

describe('CloudSwitcher', () => {
    it('keeps the title outside the named listbox, which holds only the options', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        const listbox = await openSwitcher(user)

        expect(listbox).toHaveAccessibleName('Clouds')
        expect(listbox).not.toHaveTextContent('Switch cloud')
        expect(screen.getByText('Switch cloud')).toBeInTheDocument()
        expect(Array.from(listbox.children).every((child) => child.getAttribute('role') === 'option')).toBe(true)
        expect(screen.getByRole('option', {selected: true})).toHaveAccessibleName('AWS')
    })

    it('focuses the selected cloud on open and keeps one Tab stop', async () => {
        const user = userEvent.setup()
        renderSwitcher('gcp')
        await openSwitcher(user, 'GCP')

        expect(screen.getByRole('option', {name: 'GCP'})).toHaveFocus()
        expect(screen.getAllByRole('option').filter((option) => option.tabIndex === 0)).toHaveLength(1)
    })

    it('moves focus with the arrow keys, Home and End', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)
        const options = screen.getAllByRole('option')

        await user.keyboard('{ArrowDown}')
        expect(options[1]).toHaveFocus()
        expect(options.filter((option) => option.tabIndex === 0)).toEqual([options[1]])

        await user.keyboard('{ArrowUp}{ArrowUp}')
        expect(options[options.length - 1]).toHaveFocus()

        await user.keyboard('{Home}')
        expect(options[0]).toHaveFocus()
        await user.keyboard('{End}')
        expect(options[options.length - 1]).toHaveFocus()
    })

    it('selects with Enter and returns focus to the trigger', async () => {
        const user = userEvent.setup()
        const onSelect = renderSwitcher()
        await openSwitcher(user)

        await user.keyboard('{ArrowDown}{Enter}')

        expect(onSelect).toHaveBeenCalledWith('azure')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(screen.getByRole('button', {name: 'Switch cloud, currently AWS'})).toHaveFocus()
    })

    it('closes on Escape without selecting and returns focus to the trigger', async () => {
        const user = userEvent.setup()
        const onSelect = renderSwitcher()
        await openSwitcher(user)

        await user.keyboard('{ArrowDown}{Escape}')

        expect(onSelect).not.toHaveBeenCalled()
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(screen.getByRole('button', {name: 'Switch cloud, currently AWS'})).toHaveFocus()
    })
})

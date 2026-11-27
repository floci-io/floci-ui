import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {DEFAULT_ACCOUNT_ID, getAccountId, setAccountId} from '@/lib/accountStore'
import {AccountSwitcher} from './AccountSwitcher'

const OTHER = '111111111111'
const THIRD = '222222222222'

function renderSwitcher() {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
        <QueryClientProvider client={queryClient}>
            <AccountSwitcher/>
        </QueryClientProvider>,
    )
}

async function openSwitcher(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', {name: /Switch AWS account/}))
    return screen.getByRole('listbox', {name: 'Accounts'})
}

describe('AccountSwitcher', () => {
    beforeEach(() => {
        setAccountId(THIRD)
        setAccountId(OTHER)
        setAccountId(DEFAULT_ACCOUNT_ID)
    })

    afterEach(() => {
        setAccountId(DEFAULT_ACCOUNT_ID)
    })

    it('holds only the options, with exactly one selected', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        const listbox = await openSwitcher(user)

        const options = screen.getAllByRole('option')
        expect(options.filter((option) => option.getAttribute('aria-selected') === 'true')).toHaveLength(1)
        expect(screen.getByRole('option', {selected: true})).toHaveAccessibleName(/0000-0000-0000/)
        expect(listbox).not.toContainElement(screen.getByRole('textbox', {name: 'New account id'}))
        expect(listbox).not.toHaveTextContent('Switch account')
        expect(Array.from(listbox.children).every((child) => child.getAttribute('role') === 'option')).toBe(true)
    })

    it('focuses the selected account on open and keeps one Tab stop', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)

        expect(screen.getByRole('option', {selected: true})).toHaveFocus()
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

        await user.keyboard('{ArrowUp}')
        expect(options[0]).toHaveFocus()

        await user.keyboard('{End}')
        expect(options[options.length - 1]).toHaveFocus()
        await user.keyboard('{Home}')
        expect(options[0]).toHaveFocus()
    })

    it('selects the active option with Enter and returns focus to the trigger', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)
        const target = screen.getAllByRole('option')[1].dataset.id

        await user.keyboard('{ArrowDown}{Enter}')

        expect(getAccountId()).toBe(target)
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(screen.getByRole('button', {name: /Switch AWS account/})).toHaveFocus()
    })

    it('selects with Space', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)
        const options = screen.getAllByRole('option')
        const last = options[options.length - 1].dataset.id

        await user.keyboard('{End} ')

        expect(getAccountId()).toBe(last)
    })

    it('closes on Escape and returns focus to the trigger', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)
        act(() => screen.getAllByRole('option')[1].focus())
        await user.keyboard('{Escape}')

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(getAccountId()).toBe(DEFAULT_ACCOUNT_ID)
        expect(screen.getByRole('button', {name: /Switch AWS account/})).toHaveFocus()
    })

    it('still switches to a typed account id', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)

        await user.type(screen.getByRole('textbox', {name: 'New account id'}), '333333333333{Enter}')

        expect(getAccountId()).toBe('333333333333')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
})

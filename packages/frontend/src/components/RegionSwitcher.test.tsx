import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AWS_REGIONS, getRegion, setRegion} from '@/lib/regionStore'
import {RegionSwitcher} from './RegionSwitcher'

vi.mock('@/api/queries/cloudQueries', () => ({
    useCloudStatusQuery: () => ({data: {region: 'us-east-1'}, isFetching: false}),
}))

function renderSwitcher() {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
        <QueryClientProvider client={queryClient}>
            <RegionSwitcher/>
        </QueryClientProvider>,
    )
}

async function openSwitcher(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', {name: /Switch AWS region/}))
    return screen.getByRole('listbox', {name: 'Regions'})
}

describe('RegionSwitcher', () => {
    beforeEach(() => {
        setRegion(null)
    })

    afterEach(() => {
        setRegion(null)
    })

    it('offers each region once, with exactly one selected option', async () => {
        const user = userEvent.setup()
        setRegion('eu-west-1')
        setRegion('us-west-2')
        renderSwitcher()
        await openSwitcher(user)

        const options = screen.getAllByRole('option')
        // The console default, then every region exactly once.
        expect(options).toHaveLength(AWS_REGIONS.length + 1)
        expect(options.filter((option) => option.getAttribute('aria-selected') === 'true')).toHaveLength(1)
        expect(screen.getByRole('option', {selected: true})).toHaveAccessibleName(/us-west-2/)
        expect(screen.getAllByRole('option', {name: /eu-west-1/})).toHaveLength(1)
    })

    it('keeps one label for the console default', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)
        expect(screen.getByRole('option', {selected: true})).toHaveAccessibleName(/^Console default/)
        await user.click(screen.getByRole('option', {name: /eu-central-1/}))

        await openSwitcher(user)
        expect(screen.getByRole('option', {name: /^Console default/})).toHaveAttribute('aria-selected', 'false')
    })

    it('moves the active option with the arrow keys, Home and End, as the only Tab stop', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)

        const defaultOption = screen.getByRole('option', {name: /^Console default/})
        expect(defaultOption).toHaveFocus()

        // Recent regions from earlier tests come first, so follow the list's own order.
        const options = screen.getAllByRole('option')
        await user.keyboard('{ArrowDown}')
        const first = options[1]
        expect(first).toHaveFocus()
        expect(first).toHaveAttribute('tabindex', '0')
        expect(defaultOption).toHaveAttribute('tabindex', '-1')
        expect(screen.getAllByRole('option').filter((option) => option.tabIndex === 0)).toHaveLength(1)

        await user.keyboard('{ArrowUp}')
        expect(defaultOption).toHaveFocus()

        await user.keyboard('{End}')
        expect(options[options.length - 1]).toHaveFocus()
        await user.keyboard('{Home}')
        expect(defaultOption).toHaveFocus()

        await user.keyboard('eu-w')
        expect(screen.getByRole('option', {name: /eu-west-1/})).toHaveFocus()
    })

    it('selects the active option with Enter and returns focus to the trigger', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)
        const target = screen.getAllByRole('option')[2].dataset.key

        await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

        expect(getRegion()).toBe(target)
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(screen.getByRole('button', {name: `Switch AWS region ${target}`})).toHaveFocus()
    })

    it('selects with Space', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)
        const options = screen.getAllByRole('option')
        const last = options[options.length - 1].dataset.key

        await user.keyboard('{End} ')

        expect(getRegion()).toBe(last)
    })

    it('closes on Escape and returns focus to the trigger', async () => {
        const user = userEvent.setup()
        renderSwitcher()
        await openSwitcher(user)
        await user.keyboard('{ArrowDown}{Escape}')

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(getRegion()).toBeNull()
        expect(screen.getByRole('button', {name: /Switch AWS region/})).toHaveFocus()
    })
})

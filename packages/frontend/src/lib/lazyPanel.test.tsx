import {afterEach, describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {lazyPanel} from './lazyPanel'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('lazyPanel', () => {
    it('renders the loaded panel with its props', async () => {
        const Greeting = lazyPanel(async () => ({name}: {name: string}) => <p>Hello {name}</p>)
        render(<Greeting name="floci"/>)

        expect(await screen.findByText('Hello floci')).toBeInTheDocument()
    })

    it('keeps the surrounding app mounted and offers a reload when the chunk fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const reload = vi.fn()
        vi.stubGlobal('location', {...window.location, reload})
        const Broken = lazyPanel<object>(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))
        render(
            <>
                <nav>Navigation</nav>
                <Broken/>
            </>,
        )

        expect(await screen.findByRole('alert')).toHaveTextContent('could not load')
        expect(screen.getByText('Navigation')).toBeInTheDocument()
        await userEvent.click(screen.getByRole('button', {name: 'Reload'}))
        expect(reload).toHaveBeenCalledTimes(1)
    })
})

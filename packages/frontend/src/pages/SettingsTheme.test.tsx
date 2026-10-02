import {act, render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {useTheme} from '@/lib/useTheme'
import {SettingsPage} from './SettingsPage'

vi.mock('@/api/queries/cloudQueries', () => ({useCloudsQuery: () => ({data: []})}))

function ResolvedTheme() {
    const {resolvedTheme} = useTheme()
    return <output data-testid="resolved-theme">{resolvedTheme}</output>
}

afterEach(() => vi.unstubAllGlobals())

describe('Settings theme preference', () => {
    it('follows system changes until the user chooses a fixed theme', async () => {
        let dark = false
        const listeners = new Set<() => void>()
        vi.stubGlobal('matchMedia', vi.fn(() => ({
            get matches() { return dark },
            media: '(prefers-color-scheme: dark)',
            addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
        })))
        const user = userEvent.setup()

        const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={['/settings']}>
                    <SettingsPage/><ResolvedTheme/>
                </MemoryRouter>
            </QueryClientProvider>,
        )

        await user.click(screen.getByRole('radio', {name: 'System'}))
        expect(screen.getByRole('radio', {name: 'System'})).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
        expect(document.documentElement).toHaveAttribute('data-theme', 'light')
        expect(localStorage.getItem('floci-theme')).toBe('system')

        act(() => {
            dark = true
            listeners.forEach((listener) => listener())
        })
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
        expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
        expect(localStorage.getItem('floci-theme')).toBe('system')

        await user.click(screen.getByRole('radio', {name: 'Light'}))
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
        act(() => {
            dark = false
            listeners.forEach((listener) => listener())
        })
        act(() => {
            dark = true
            listeners.forEach((listener) => listener())
        })
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
        expect(document.documentElement).toHaveAttribute('data-theme', 'light')
        expect(localStorage.getItem('floci-theme')).toBe('light')

        await user.click(screen.getByRole('radio', {name: 'Dark'}))
        act(() => {
            dark = false
            listeners.forEach((listener) => listener())
        })
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
        expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    })
})

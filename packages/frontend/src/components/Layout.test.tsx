import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {BrowserRouter, Outlet, Route, Routes, useNavigate} from 'react-router-dom'
import {afterEach, describe, expect, test} from 'vitest'
import {lazyPanel} from '@/lib/lazyPanel'
import {TopbarSearch} from './Layout'

function SearchShell() {
    const navigate = useNavigate()
    return (
        <>
            <button onClick={() => navigate('/settings')}>Settings</button>
            <TopbarSearch/>
            <Outlet/>
        </>
    )
}

function renderWithDelayedSettings() {
    let releaseImport!: () => void
    const importGate = new Promise<void>((resolve) => {
        releaseImport = resolve
    })
    const SettingsRoute = lazyPanel(() => importGate.then(() =>
        import('./LayoutTestSettingsPage').then((module) => module.SettingsRoute)))

    render(
        <BrowserRouter>
            <Routes>
                <Route element={<SearchShell/>}>
                    <Route path="/cloud-explorer/aws/storage" element={<div>Storage page</div>}/>
                    <Route path="/settings" element={<SettingsRoute/>}/>
                </Route>
            </Routes>
        </BrowserRouter>,
    )
    return releaseImport
}

describe('TopbarSearch during navigation', () => {
    afterEach(() => {
        window.history.replaceState(null, '', '/')
    })

    test('keeps a search on the destination before and after its page chunk loads', async () => {
        window.history.replaceState(null, '', '/cloud-explorer/aws/storage')
        const releaseImport = renderWithDelayedSettings()
        expect(screen.getByText('Storage page')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', {name: 'Settings'}))
        expect(window.location.pathname).toBe('/settings')
        expect(screen.queryByText('Settings page')).not.toBeInTheDocument()

        const input = screen.getByRole('textbox', {name: /search services/i})
        fireEvent.change(input, {target: {value: 'storage'}})
        await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/settings?search=storage'))
        expect(input).toHaveValue('storage')
        expect(screen.queryByText('Settings page')).not.toBeInTheDocument()

        await act(async () => releaseImport())
        await waitFor(() => expect(screen.getByText('Settings page')).toBeInTheDocument())
        expect(window.location.pathname + window.location.search).toBe('/settings?search=storage')
        expect(input).toHaveValue('storage')
    })

    test('discards a draft when Back leaves a destination whose page chunk is loading', async () => {
        window.history.replaceState(null, '', '/cloud-explorer/aws/storage')
        const releaseImport = renderWithDelayedSettings()
        fireEvent.click(screen.getByRole('button', {name: 'Settings'}))
        const input = screen.getByRole('textbox', {name: /search services/i})
        fireEvent.change(input, {target: {value: 'stale'}})
        await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/settings?search=stale'))
        expect(input).toHaveValue('stale')
        expect(screen.queryByText('Settings page')).not.toBeInTheDocument()

        await act(async () => {
            window.history.back()
        })
        await waitFor(() => expect(window.location.pathname).toBe('/cloud-explorer/aws/storage'))
        await waitFor(() => expect(input).toHaveValue(''))
        await act(async () => releaseImport())
        expect(screen.queryByText('Settings page')).not.toBeInTheDocument()
        expect(window.location.pathname + window.location.search).toBe('/cloud-explorer/aws/storage')
    })
    test('commits an ordinary search and clears it on Escape', async () => {
        window.history.replaceState(null, '', '/settings')
        render(<BrowserRouter><TopbarSearch/></BrowserRouter>)
        const input = screen.getByRole('textbox', {name: /search services/i})

        fireEvent.change(input, {target: {value: 'queue'}})
        await waitFor(() => expect(window.location.search).toBe('?search=queue'))
        expect(input).toHaveValue('queue')

        fireEvent.keyDown(input, {key: 'Escape'})
        await waitFor(() => expect(window.location.search).toBe(''))
        expect(input).toHaveValue('')
    })

    test('discards a draft when a different route with its own query is chosen', async () => {
        window.history.replaceState(null, '', '/cloud-explorer/aws/storage')
        function SearchShell() {
            const navigate = useNavigate()
            return (
                <>
                    <TopbarSearch/>
                    <button onClick={() => navigate('/settings?search=existing')}>Go elsewhere</button>
                </>
            )
        }
        render(<BrowserRouter><SearchShell/></BrowserRouter>)
        const input = screen.getByRole('textbox', {name: /search services/i})
        fireEvent.change(input, {target: {value: 'stale'}})
        fireEvent.click(screen.getByRole('button', {name: 'Go elsewhere'}))

        await waitFor(() => expect(input).toHaveValue('existing'))
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })
        expect(window.location.pathname + window.location.search).toBe('/settings?search=existing')
    })
})

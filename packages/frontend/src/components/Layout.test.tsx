import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {Suspense} from 'react'
import {BrowserRouter, Route, Routes, useNavigate} from 'react-router-dom'
import {afterEach, describe, expect, test} from 'vitest'
import {TopbarSearch} from './Layout'

describe('TopbarSearch during navigation', () => {
    afterEach(() => {
        window.history.replaceState(null, '', '/')
    })

    test('commits text typed while the destination route is suspended to that route', async () => {
        window.history.replaceState(null, '', '/cloud-explorer/aws/storage')
        let releaseDestination!: () => void
        let destinationReady = false
        const destination = new Promise<void>((resolve) => {
            releaseDestination = resolve
        })

        function SettingsRoute() {
            if (!destinationReady) throw destination
            return <div>Settings page</div>
        }

        function SearchShell() {
            const navigate = useNavigate()
            return (
                <>
                    <button onClick={() => navigate('/settings')}>Settings</button>
                    <TopbarSearch/>
                    <Suspense fallback={<div>Loading settings</div>}>
                        <Routes>
                            <Route path="/cloud-explorer/aws/storage" element={<div>Storage page</div>}/>
                            <Route path="/settings" element={<SettingsRoute/>}/>
                        </Routes>
                    </Suspense>
                </>
            )
        }

        render(<BrowserRouter><SearchShell/></BrowserRouter>)
        expect(screen.getByText('Storage page')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', {name: 'Settings'}))
        expect(window.location.pathname).toBe('/settings')

        const input = screen.getByRole('textbox', {name: /search services/i})
        fireEvent.change(input, {target: {value: 'storage'}})
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })
        expect(window.location.pathname).toBe('/settings')

        await act(async () => {
            destinationReady = true
            releaseDestination()
        })
        await waitFor(() => expect(screen.getByText('Settings page')).toBeInTheDocument())
        await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/settings?search=storage'))
        expect(input).toHaveValue('storage')
    })

    test('discards a draft when Back cancels a suspended destination after the debounce', async () => {
        window.history.replaceState(null, '', '/cloud-explorer/aws/storage')
        let releaseDestination!: () => void
        let destinationReady = false
        const destination = new Promise<void>((resolve) => {
            releaseDestination = resolve
        })

        function SettingsRoute() {
            if (!destinationReady) throw destination
            return <div>Settings page</div>
        }

        function SearchShell() {
            const navigate = useNavigate()
            return (
                <>
                    <button onClick={() => navigate('/settings')}>Settings</button>
                    <TopbarSearch/>
                    <Suspense fallback={<div>Loading settings</div>}>
                        <Routes>
                            <Route path="/cloud-explorer/aws/storage" element={<div>Storage page</div>}/>
                            <Route path="/settings" element={<SettingsRoute/>}/>
                        </Routes>
                    </Suspense>
                </>
            )
        }

        render(<BrowserRouter><SearchShell/></BrowserRouter>)
        fireEvent.click(screen.getByRole('button', {name: 'Settings'}))
        const input = screen.getByRole('textbox', {name: /search services/i})
        fireEvent.change(input, {target: {value: 'stale'}})
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })
        expect(window.location.pathname).toBe('/settings')
        expect(input).toHaveValue('stale')

        await act(async () => {
            window.history.back()
        })
        await waitFor(() => expect(window.location.pathname).toBe('/cloud-explorer/aws/storage'))
        await waitFor(() => expect(input).toHaveValue(''))
        destinationReady = true
        await act(async () => releaseDestination())
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

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {MemoryRouter, Route, Routes, useParams} from 'react-router-dom'
import {describe, expect, it, vi} from 'vitest'
import {DEFAULT_ACCOUNT_ID, setAccountId} from '@/lib/accountStore'
import {SettingsPage} from './SettingsPage'

vi.mock('@/api/queries/cloudQueries', () => ({
    useCloudsQuery: () => ({
        data: [
            {id: 'aws', displayName: 'AWS', availability: 'available'},
            {id: 'azure', displayName: 'Azure', availability: 'available'},
            {id: 'gcp', displayName: 'GCP', availability: 'available'},
        ],
    }),
}))

function SelectedCloud() {
    const {cloud} = useParams()
    return <div>Selected {cloud}</div>
}

describe('SettingsPage', () => {
    it('keeps cloud and account selection in Settings and navigates after a cloud switch', async () => {
        setAccountId(DEFAULT_ACCOUNT_ID)
        const user = userEvent.setup()
        const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={['/console/aws/settings']}>
                    <Routes>
                        <Route path="/console/:cloud/settings" element={<SettingsPage/>}/>
                        <Route path="/console/:cloud" element={<SelectedCloud/>}/>
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        )

        expect(screen.getByRole('button', {name: 'Switch cloud, currently AWS'})).toBeInTheDocument()
        expect(screen.getByRole('button', {name: /Switch AWS account/})).toBeInTheDocument()

        await user.click(screen.getByRole('button', {name: 'Switch cloud, currently AWS'}))
        await user.click(screen.getByRole('option', {name: 'Azure'}))

        expect(screen.getByText('Selected azure')).toBeInTheDocument()
    })
})

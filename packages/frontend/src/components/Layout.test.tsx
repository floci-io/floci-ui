import {act, fireEvent, render, screen} from '@testing-library/react'
import {MemoryRouter, useLocation} from 'react-router-dom'
import {afterEach, describe, expect, test, vi} from 'vitest'
import {TopbarSearch} from './Layout'

function LocationProbe() {
    const location = useLocation()
    return <output aria-label="location">{location.pathname}{location.search}</output>
}

function renderSearch(initialEntry = '/console/aws') {
    render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <TopbarSearch/>
            <LocationProbe/>
        </MemoryRouter>,
    )
}

describe('TopbarSearch', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    test('commits the current draft to the URL after debounce', () => {
        vi.useFakeTimers()
        renderSearch()

        const input = screen.getByRole('textbox', {name: /search services/i})
        fireEvent.change(input, {target: {value: 'sage'}})

        expect(input).toHaveValue('sage')
        expect(screen.getByLabelText('location')).toHaveTextContent('/console/aws')

        act(() => {
            vi.advanceTimersByTime(300)
        })

        expect(input).toHaveValue('sage')
        expect(screen.getByLabelText('location')).toHaveTextContent('/console/aws?search=sage')
    })

    test('restores the route search query only when the path changes', () => {
        vi.useFakeTimers()
        renderSearch('/console/aws?search=ec2')

        const input = screen.getByRole('textbox', {name: /search services/i})
        expect(input).toHaveValue('ec2')

        fireEvent.change(input, {target: {value: 'sagemaker'}})
        expect(input).toHaveValue('sagemaker')

        act(() => {
            vi.advanceTimersByTime(300)
        })

        expect(input).toHaveValue('sagemaker')
        expect(screen.getByLabelText('location')).toHaveTextContent('/console/aws?search=sagemaker')
    })
})

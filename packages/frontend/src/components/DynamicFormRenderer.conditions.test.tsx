import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe, expect, test, vi} from 'vitest'
import type {ServiceSchema} from '@/types/schema'
import {DynamicFormRenderer} from './DynamicFormRenderer'

const {ociIdentitySchema} = await vi.importActual<{ociIdentitySchema: () => ServiceSchema}>(
    '../../../api/src/cloud-spi/iamSchema',
)

function schema(): ServiceSchema {
    return JSON.parse(JSON.stringify(ociIdentitySchema())) as ServiceSchema
}

describe('conditional fields with notEquals', () => {
    test('asks for a name and description for every kind but a region subscription', async () => {
        const user = userEvent.setup()
        render(<DynamicFormRenderer schema={schema()} isSubmitting={false} onSubmit={vi.fn()}/>)

        expect(screen.getByPlaceholderText('Name')).toBeVisible()
        expect(screen.getByPlaceholderText('Description')).toBeVisible()
        expect(screen.queryByPlaceholderText('Region')).not.toBeInTheDocument()

        await user.selectOptions(screen.getByRole('combobox'), 'regionSubscriptions')

        expect(screen.queryByPlaceholderText('Name')).not.toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Description')).not.toBeInTheDocument()
        expect(screen.getByPlaceholderText('Region')).toBeVisible()
    })

    test('submits a region subscription with only the region filled in', async () => {
        const onSubmit = vi.fn()
        const user = userEvent.setup()
        render(<DynamicFormRenderer schema={schema()} isSubmitting={false} onSubmit={onSubmit}/>)

        await user.selectOptions(screen.getByRole('combobox'), 'regionSubscriptions')
        await user.click(screen.getByRole('button', {name: 'Create'}))
        expect(onSubmit).not.toHaveBeenCalled()
        expect(screen.getByText('Region is required.')).toBeVisible()

        await user.type(screen.getByPlaceholderText('Region'), 'PHX')
        await user.click(screen.getByRole('button', {name: 'Create'}))

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({kind: 'regionSubscriptions', region: 'PHX'}))
    })
})

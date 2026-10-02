import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe, expect, test, vi} from 'vitest'
import type {ServiceSchema} from '@/types/schema'
import {DynamicFormRenderer} from './DynamicFormRenderer'

const {azureTableSchema} = await vi.importActual<{azureTableSchema: () => ServiceSchema}>(
    '../../../api/src/cloud-spi/tableSchema',
)

function serializedSchema(): ServiceSchema {
    return JSON.parse(JSON.stringify(azureTableSchema())) as ServiceSchema
}

describe('Azure Table create form', () => {
    test.each(['tables', 'Tables', 'TABLES', 'tAbLeS'])(
        'blocks reserved table name %s before submitting', async (tableName) => {
            const onSubmit = vi.fn()
            const user = userEvent.setup()
            render(<DynamicFormRenderer schema={serializedSchema()} isSubmitting={false} onSubmit={onSubmit}/>)

            const input = screen.getByPlaceholderText('Table Name')
            await user.type(input, tableName)
            await user.click(screen.getByRole('button', {name: 'Create'}))

            expect(onSubmit).not.toHaveBeenCalled()
            expect(input).toHaveAttribute('aria-invalid', 'true')
            expect(screen.getByText(/reserved/i)).toBeVisible()
        },
    )

    test.each(['Table', 'Tables1', 'TablesArchive', 'MyTables'])(
        'submits valid table name %s without changing its case', async (tableName) => {
            const onSubmit = vi.fn()
            const user = userEvent.setup()
            render(<DynamicFormRenderer schema={serializedSchema()} isSubmitting={false} onSubmit={onSubmit}/>)

            await user.type(screen.getByPlaceholderText('Table Name'), tableName)
            await user.click(screen.getByRole('button', {name: 'Create'}))

            expect(onSubmit).toHaveBeenCalledOnce()
            expect(onSubmit).toHaveBeenCalledWith({tableName})
        },
    )
})

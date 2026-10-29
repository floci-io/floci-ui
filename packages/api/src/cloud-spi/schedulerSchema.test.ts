import {describe, expect, test} from 'bun:test'
import {schedulerSchemaFor} from './schedulerSchema'

describe('schedulerSchemaFor', () => {
    test('exposes AWS EventBridge Scheduler with an ARN target', () => {
        const schema = schedulerSchemaFor('aws')

        expect(schema).toMatchObject({cloud: 'aws', service: 'scheduler'})
        expect(schema?.columns.find(column => column.name === 'target')?.label).toBe('Target ARN')
        expect(schema?.fields.some(field => field.name === 'flexibleTimeWindowMode')).toBe(false)
    })

    test('keeps GCP Cloud Scheduler target URI labeling', () => {
        expect(schedulerSchemaFor('gcp')?.columns.find(column => column.name === 'target')?.label).toBe('Target URI')
    })
})

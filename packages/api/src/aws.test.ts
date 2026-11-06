import {afterEach, describe, expect, test} from 'bun:test'
import {credentialsForAccount, defaultAccountId} from './aws'

const originalKey = process.env.AWS_ACCESS_KEY_ID

afterEach(() => {
    if (originalKey === undefined) delete process.env.AWS_ACCESS_KEY_ID
    else process.env.AWS_ACCESS_KEY_ID = originalKey
})

describe('credentialsForAccount', () => {
    test('signs the default account with AWS_ACCESS_KEY_ID when it is not an account id', () => {
        process.env.AWS_ACCESS_KEY_ID = 'test'

        expect(credentialsForAccount(defaultAccountId()).accessKeyId).toBe('test')
    })

    test('keeps the account id as the key for any other account', () => {
        process.env.AWS_ACCESS_KEY_ID = 'test'

        expect(credentialsForAccount('123456789012').accessKeyId).toBe('123456789012')
    })

    test('uses the account id as the key when AWS_ACCESS_KEY_ID is an account id', () => {
        process.env.AWS_ACCESS_KEY_ID = '210987654321'

        expect(defaultAccountId()).toBe('210987654321')
        expect(credentialsForAccount('210987654321').accessKeyId).toBe('210987654321')
    })

    test('uses the account id as the key when AWS_ACCESS_KEY_ID is unset', () => {
        delete process.env.AWS_ACCESS_KEY_ID

        expect(credentialsForAccount(defaultAccountId()).accessKeyId).toBe(defaultAccountId())
    })
})

import {describe, expect, test} from 'bun:test'
import {isLoopbackSqlHost} from './sqlTransport'

describe('isLoopbackSqlHost', () => {
    test('treats loopback addresses as local', () => {
        for (const host of ['localhost', 'LOCALHOST', ' 127.0.0.1 ', '127.1.2.3', '::1', '[::1]']) {
            expect(isLoopbackSqlHost(host)).toBe(true)
        }
    })

    test('treats every other host as remote so TLS stays enforced', () => {
        for (const host of [
            'db.example.com',
            '10.0.0.5',
            '192.168.1.10',
            '0.0.0.0',
            'localhost.evil.com',
            '127.0.0.1.evil.com',
            '2600::1',
        ]) {
            expect(isLoopbackSqlHost(host)).toBe(false)
        }
    })
})

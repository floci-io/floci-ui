import {describe, expect, test} from 'bun:test'
import {azureSqlTlsMode, isLoopbackSqlHost, postgresTlsMode} from './sqlTransport'

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

describe('azureSqlTlsMode', () => {
    test('trusts the emulator certificate for container-network endpoints', () => {
        expect(azureSqlTlsMode('floci-az-sql-app', 'None', true)).toBe('trust-server-certificate')
    })

    test('keeps certificate verification for remote endpoints without the emulator hint', () => {
        expect(azureSqlTlsMode('db.example.com', 'None', false)).toBe('verify')
        expect(azureSqlTlsMode('db.example.com', '1.2', true)).toBe('verify')
        expect(azureSqlTlsMode('db.example.com', null, false)).toBe('verify')
    })
})

describe('postgresTlsMode', () => {
    test('disables TLS for the emulator local-port extension', () => {
        expect(postgresTlsMode('floci-az-pg-app', true)).toBe('disable')
    })

    test('keeps certificate verification for remote endpoints without the emulator hint', () => {
        expect(postgresTlsMode('db.example.com', false)).toBe('verify')
    })
})

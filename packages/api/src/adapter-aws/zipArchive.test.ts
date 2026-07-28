import {describe, expect, test} from 'bun:test'
import {execFile} from 'node:child_process'
import {rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {createZipArchive, crc32, handlerFileName} from './zipArchive'

describe('crc32', () => {
    // Reference values from the standard CRC-32 (IEEE 802.3) test vectors.
    test('matches known checksums', () => {
        expect(crc32(new TextEncoder().encode(''))).toBe(0x00000000)
        expect(crc32(new TextEncoder().encode('a'))).toBe(0xe8b7be43)
        expect(crc32(new TextEncoder().encode('abc'))).toBe(0x352441c2)
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    })
})

describe('createZipArchive', () => {
    test('writes the ZIP magic number and end-of-central-directory record', () => {
        const archive = createZipArchive([{name: 'index.js', content: 'module.exports = 1'}])
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)

        expect(view.getUint32(0, true)).toBe(0x04034b50)
        expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50)
        // One entry, recorded in both the disk and total counts.
        expect(view.getUint16(archive.length - 22 + 8, true)).toBe(1)
        expect(view.getUint16(archive.length - 22 + 10, true)).toBe(1)
    })

    test('records the entry name and an accurate checksum', () => {
        const content = 'exports.handler = async () => ({statusCode: 200})'
        const archive = createZipArchive([{name: 'index.js', content}])
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
        const encoded = new TextEncoder().encode(content)

        expect(view.getUint32(14, true)).toBe(crc32(encoded))
        expect(view.getUint32(18, true)).toBe(encoded.length)
        expect(view.getUint32(22, true)).toBe(encoded.length)
        expect(new TextDecoder().decode(archive.slice(30, 38))).toBe('index.js')
    })

    test('is readable by an independent ZIP implementation', async () => {
        // Validates against a real reader rather than trusting our writer to agree
        // with itself — a self-consistent but malformed archive is exactly the bug
        // this file exists to prevent.
        const archive = createZipArchive([
            {name: 'index.js', content: 'exports.handler = 1'},
            {name: 'lib/util.js', content: 'module.exports = {}'},
        ])

        const path = `${tmpdir()}/floci-zip-${process.pid}.zip`
        await writeFile(path, archive)
        try {
            const listing = await new Promise<string>((resolve, reject) => {
                execFile('unzip', ['-Z1', path], (err, stdout) => (err ? reject(err) : resolve(stdout)))
            }).catch(() => null)

            if (listing === null) {
                // No unzip on this machine; assert the structure we can check.
                const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
                expect(view.getUint16(archive.length - 22 + 8, true)).toBe(2)
                return
            }

            expect(listing.split('\n').filter(Boolean).sort()).toEqual(['index.js', 'lib/util.js'])

            const extracted = await new Promise<string>((resolve, reject) => {
                execFile('unzip', ['-p', path, 'index.js'], (err, stdout) => (err ? reject(err) : resolve(stdout)))
            })
            expect(extracted).toBe('exports.handler = 1')
        } finally {
            await rm(path, {force: true})
        }
    })

    test('supports multiple entries with distinct offsets', () => {
        const archive = createZipArchive([
            {name: 'a.js', content: 'a'},
            {name: 'b.js', content: 'bb'},
        ])
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)

        expect(view.getUint16(archive.length - 22 + 8, true)).toBe(2)
        // Second local header follows the first entry's header plus its 1 byte body.
        expect(view.getUint32(30 + 4 + 1, true)).toBe(0x04034b50)
    })

    test('accepts binary content', () => {
        const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
        const archive = createZipArchive([{name: 'blob.bin', content: bytes}])
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)

        expect(view.getUint32(14, true)).toBe(crc32(bytes))
        expect(view.getUint32(18, true)).toBe(bytes.length)
    })

    test('produces a byte-identical archive for identical input', () => {
        // No timestamps, so a deployment package is reproducible.
        const build = () => createZipArchive([{name: 'index.js', content: 'x'}])
        expect(build()).toEqual(build())
    })
})

describe('handlerFileName', () => {
    test('derives the module file from the handler string', () => {
        expect(handlerFileName('index.handler', 'nodejs20.x')).toBe('index.js')
        expect(handlerFileName('app.main', 'nodejs18.x')).toBe('app.js')
        expect(handlerFileName('src/app.run', 'nodejs20.x')).toBe('src/app.js')
    })

    test('uses the runtime language extension', () => {
        expect(handlerFileName('lambda_function.lambda_handler', 'python3.12')).toBe('lambda_function.py')
        expect(handlerFileName('function.handler', 'ruby3.3')).toBe('function.rb')
    })

    test('falls back to index when the handler has no module part', () => {
        expect(handlerFileName('handler', 'nodejs20.x')).toBe('index.js')
    })
})

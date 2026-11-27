import {describe, expect, test} from 'bun:test'
import {readdirSync} from 'node:fs'
import path from 'node:path'
import {awsStorageSchema} from './storageSchema'

interface FoundPattern {
    where: string
    pattern: string
}

/**
 * Every `validation.pattern` reachable from what a schema module exports: the
 * `*Schema` factories (called with their defaults) and any exported constants.
 */
async function schemaPatterns(): Promise<FoundPattern[]> {
    const found: FoundPattern[] = []
    const walk = (value: unknown, where: string, seen: Set<unknown>) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return
        seen.add(value)
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (key === 'validation' && child && typeof child === 'object') {
                const {pattern} = child as {pattern?: unknown}
                if (typeof pattern === 'string') found.push({where, pattern})
            }
            walk(child, `${where}.${key}`, seen)
        }
    }

    const files = readdirSync(import.meta.dir).filter((file) => file.endsWith('Schema.ts'))
    for (const file of files) {
        const module = await import(path.join(import.meta.dir, file)) as Record<string, unknown>
        for (const [name, exported] of Object.entries(module)) {
            if (typeof exported !== 'function') walk(exported, `${file}:${name}`, new Set())
            else if (name.endsWith('Schema')) walk((exported as () => unknown)(), `${file}:${name}`, new Set())
        }
    }
    return found
}

/** What a browser compiles for `<input pattern>`: anchored, with the `v` flag. */
function compileAsHtmlPattern(pattern: string): RegExp {
    return new RegExp(`^(?:${pattern})$`, 'v')
}

/**
 * Bun's engine accepts a trailing `-` in a class such as `[a-z0-9.-]` under
 * the `v` flag, but V8 (and so Chrome) rejects it: in `v` mode a `-` in a class
 * is only a range operator between two single characters. This catches the
 * hyphens the local compile lets through.
 */
function strayClassHyphen(pattern: string): boolean {
    let inClass = false
    /** The previous class atom could start a range (a single character). */
    let rangeable = false
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index]
        if (char === '\\') {
            const escaped = pattern[index + 1] ?? ''
            rangeable = inClass && !/[dDwWsSpP]/.test(escaped)
            index++
            continue
        }
        if (!inClass) {
            if (char === '[') {
                inClass = true
                rangeable = false
                if (pattern[index + 1] === '^') index++
            }
            continue
        }
        if (char === ']') {
            inClass = false
        } else if (char === '-') {
            const next = pattern[index + 1]
            if (!rangeable || next === undefined || next === ']' || next === '-') return true
            // Skip the range's end, escaped or not: it cannot start another range.
            index += next === '\\' ? 2 : 1
            rangeable = false
        } else {
            rangeable = true
        }
    }
    return false
}

describe('schema validation patterns', () => {
    test('every pattern compiles with the v flag browsers use for the pattern attribute', async () => {
        const patterns = await schemaPatterns()
        expect(patterns.length).toBeGreaterThan(50)

        const invalid = patterns.filter(({pattern}) => {
            try {
                compileAsHtmlPattern(pattern)
                return strayClassHyphen(pattern)
            } catch {
                return true
            }
        })
        expect(invalid).toEqual([])
    })

    test('the hyphen check flags what V8 rejects and passes real ranges', () => {
        for (const bad of ['[a-z0-9.-]', '[a-z-]', '[-a-z]', '[^-a]', '[a-z-0]', '[\\d-x]']) {
            expect(strayClassHyphen(bad)).toBe(true)
        }
        for (const good of ['[a-z0-9.\\-]', '[\\-a-z]', 'a-b', '[a\\-z]', '[\\.-z]', '(?!.*--)[a-z]']) {
            expect(strayClassHyphen(good)).toBe(false)
        }
    })

    test('the S3 bucket name pattern accepts and rejects the same names as before', () => {
        const pattern = awsStorageSchema().fields.find((field) => field.name === 'bucketName')?.validation?.pattern
        expect(pattern).toBeString()
        const asHtml = compileAsHtmlPattern(pattern!)
        const asScript = new RegExp(pattern!)

        const valid = ['abc', 'my-bucket', 'my.bucket.name', 'a1-b2.c3', 'x'.repeat(63), '1bucket', 'bucket-1']
        const rejected = [
            'ab', 'x'.repeat(64), 'My-Bucket', '-bucket', 'bucket-', '.bucket', 'bucket.',
            'my..bucket', 'my.-bucket', 'my-.bucket', '192.168.5.4', 'my_bucket',
            'bucket--x-s3', 'bucket-s3alias',
        ]
        for (const name of valid) {
            expect(asHtml.test(name)).toBe(true)
            expect(asScript.test(name)).toBe(true)
        }
        for (const name of rejected) {
            expect(asHtml.test(name)).toBe(false)
            expect(asScript.test(name)).toBe(false)
        }
    })
})

import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'

/**
 * The doc block that sits above each method of a file, by the method's name.
 *
 * <p>A block that documents nothing is a block stacked on another one, so the
 * map says where the blocks of the file really are.
 */
function documentedMethods(source: string): Map<string, string> {
    const documented = new Map<string, string>()
    const pattern = /((?:\/\*\*[\s\S]*?\*\/\s*)+)(?:public |private |protected )?(?:async )?([A-Za-z_]\w*)\s*\(/g
    for (const match of source.matchAll(pattern)) {
        documented.set(match[2], match[1])
    }
    return documented
}

describe('the doc blocks of the service', () => {
    test('every block sits above the method it documents', () => {
        const source = readFileSync(new URL('./CloudProxyService.ts', import.meta.url), 'utf8')
        const documented = documentedMethods(source)

        // The policy's block sits above the method that sets a policy and the
        // usage's above the method that sets a usage: a block stacked on
        // another one documents neither.
        expect(documented.get('setPaymentCryptographyKeyPolicy')).toContain(
            'The policy that lets another account use a key.',
        )
        expect(documented.get('setPaymentCryptographyKeyUsage')).toContain('Whether a key may be used.')
        expect(documented.get('setPaymentCryptographyKeyUsage')).not.toContain(
            'The policy that lets another account use a key.',
        )
    })
})

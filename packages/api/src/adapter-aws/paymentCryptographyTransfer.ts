import {
    ExportKeyCommand,
    ImportKeyCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {ExportedKeyMaterial} from '../cloud-spi/types'

export type {ExportedKeyMaterial}

/**
 * The form a TR-31 block is written in: a version identifier and then the
 * block itself, one character per byte.
 *
 * <p>The block is not hexadecimal throughout: its header carries the usage and
 * the algorithm as the characters the reference names them with, so the block
 * is written in digits and letters rather than in digits and A to F.
 */
const BLOCK_PATTERN = /^[0-9A-Fa-f]{2}[0-9A-Za-z]*$/

/**
 * The block a key comes in under, in the form the reference writes it in.
 *
 * <p>A block that came out of a tool or out of a textarea carries the line
 * breaks it was wrapped at, and the reference has no room for them, so the
 * whitespace is taken off here rather than refused there. What is left has to
 * be a block, so a slip of the keyboard is refused as one.
 */
export function canonicalBlock(block: string): string {
    const canonical = block.replace(/\s+/g, '')
    if (!canonical) throw new ValidationError('the wrapped key block is empty')
    if (!BLOCK_PATTERN.test(canonical) || canonical.length % 2 !== 0) {
        throw new ValidationError('the wrapped key block must be the block the service wrote')
    }
    return canonical
}

/**
 * A key leaves under a TR-31 block the service wraps with a key the account holds.
 *
 * <p>The caller is the one that has to make sure of the wrapping key: it has to
 * be a key encryption key that may wrap, and at least as strong as the key it
 * carries. The service refuses a weaker one, so that refusal comes from there.
 */
export async function exportKeyTr31(
    client: PaymentCryptographyClient,
    keyArn: string,
    wrappingKeyArn: string,
): Promise<ExportedKeyMaterial> {
    const res = await client.send(
        new ExportKeyCommand({
            ExportKeyIdentifier: keyArn,
            KeyMaterial: {Tr31KeyBlock: {WrappingKeyIdentifier: wrappingKeyArn}},
        }),
    )
    const wrapped = res.WrappedKey
    // The service answered without the material, so the export produced
    // nothing: an empty block would look like an export that worked.
    if (!wrapped?.KeyMaterial) {
        throw new RuntimeError('Payment Cryptography did not return the material the key left under')
    }
    return {
        keyMaterial: wrapped.KeyMaterial,
        format: wrapped.WrappedKeyMaterialFormat ?? null,
        wrappingKeyArn: wrapped.WrappingKeyArn ?? null,
        keyCheckValue: wrapped.KeyCheckValue ?? null,
    }
}

/**
 * A key comes in under a TR-31 block a key the account holds wraps.
 *
 * <p>The block and the wrapping key are the two halves of the same exchange, so
 * the service refuses a pair that does not go together.
 */
export async function importKeyTr31(
    client: PaymentCryptographyClient,
    wrappingKeyArn: string,
    wrappedKeyBlock: string,
    enabled: boolean,
): Promise<string | null> {
    const res = await client.send(
        new ImportKeyCommand({
            KeyMaterial: {
                Tr31KeyBlock: {
                    WrappingKeyIdentifier: wrappingKeyArn,
                    WrappedKeyBlock: canonicalBlock(wrappedKeyBlock),
                },
            },
            Enabled: enabled,
        }),
    )
    return res.Key?.KeyArn ?? null
}

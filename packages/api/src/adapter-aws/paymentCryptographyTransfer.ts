import {
    ExportKeyCommand,
    ImportKeyCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import type {ExportedKeyMaterial} from '../cloud-spi/types'

export type {ExportedKeyMaterial}

/**
 * A key leaves under a TR-31 block the service wraps with a key the account holds.
 *
 * <p>The wrapping key has to be a key encryption key that may wrap, and at least as
 * strong as the key it carries: the reference refuses a weaker one, and its table
 * says which pairs hold.
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
    return {
        keyMaterial: wrapped?.KeyMaterial ?? '',
        format: wrapped?.WrappedKeyMaterialFormat ?? null,
        wrappingKeyArn: wrapped?.WrappingKeyArn ?? null,
        keyCheckValue: wrapped?.KeyCheckValue ?? null,
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
            KeyMaterial: {Tr31KeyBlock: {WrappingKeyIdentifier: wrappingKeyArn, WrappedKeyBlock: wrappedKeyBlock}},
            Enabled: enabled,
        }),
    )
    return res.Key?.KeyArn ?? null
}

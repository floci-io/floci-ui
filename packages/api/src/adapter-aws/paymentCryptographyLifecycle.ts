import {StartKeyUsageCommand, StopKeyUsageCommand, type PaymentCryptographyClient} from '@aws-sdk/client-payment-cryptography'

/**
 * Whether a key may be used.
 *
 * <p>Disabling a key is the reversible alternative to deleting it: the key stays
 * readable and does no work until it is enabled again, which is what the reference
 * recommends when a key has to stop working today.
 */
export async function setKeyUsage(
    client: PaymentCryptographyClient,
    keyArn: string,
    enabled: boolean,
): Promise<void> {
    const command = enabled
        ? new StartKeyUsageCommand({KeyIdentifier: keyArn})
        : new StopKeyUsageCommand({KeyIdentifier: keyArn})
    await client.send(command)
}

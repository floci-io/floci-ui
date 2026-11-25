import {
    AddKeyReplicationRegionsCommand,
    RemoveKeyReplicationRegionsCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'

/**
 * The Regions a key is replicated to, added to the ones it holds.
 *
 * <p>The Regions named are the ones to add: the caller diffs them against the
 * ones the key holds, because the helper does not diff for itself.
 */
export async function addReplicationRegions(
    client: PaymentCryptographyClient,
    keyArn: string,
    regions: string[],
): Promise<void> {
    // The reference's own commands name the Regions they change, so a list
    // that names no Region is not a request the service can act on. The helper
    // is exported, so it does not leave the check to every caller.
    if (regions.length === 0) return
    await client.send(
        new AddKeyReplicationRegionsCommand({KeyIdentifier: keyArn, ReplicationRegions: regions}),
    )
}

/**
 * The Regions a key is replicated to, taken away from the ones it holds.
 *
 * <p>The Regions named are the ones to remove: the caller diffs them against
 * the ones the key holds, because the helper does not diff for itself.
 */
export async function removeReplicationRegions(
    client: PaymentCryptographyClient,
    keyArn: string,
    regions: string[],
): Promise<void> {
    // The reference's own commands name the Regions they change, so a list
    // that names no Region is not a request the service can act on. The helper
    // is exported, so it does not leave the check to every caller.
    if (regions.length === 0) return
    await client.send(
        new RemoveKeyReplicationRegionsCommand({KeyIdentifier: keyArn, ReplicationRegions: regions}),
    )
}

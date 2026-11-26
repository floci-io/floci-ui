import {
    AddKeyReplicationRegionsCommand,
    DisableDefaultKeyReplicationRegionsCommand,
    EnableDefaultKeyReplicationRegionsCommand,
    GetDefaultKeyReplicationRegionsCommand,
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

/**
 * The Regions the account replicates a new key to by default.
 *
 * <p>The setting is the one of the Region the request is in, so each Region has
 * its own.
 */
export async function defaultReplicationRegions(
    client: PaymentCryptographyClient,
): Promise<string[]> {
    const res = await client.send(new GetDefaultKeyReplicationRegionsCommand({}))
    return res.EnabledReplicationRegions ?? []
}

/** Turns the account's default replication on for the Regions named. */
export async function enableDefaultReplicationRegions(
    client: PaymentCryptographyClient,
    regions: string[],
): Promise<string[]> {
    const res = await client.send(
        new EnableDefaultKeyReplicationRegionsCommand({ReplicationRegions: regions}),
    )
    return res.EnabledReplicationRegions ?? []
}

/** Turns the account's default replication off for the Regions named. */
export async function disableDefaultReplicationRegions(
    client: PaymentCryptographyClient,
    regions: string[],
): Promise<string[]> {
    const res = await client.send(
        new DisableDefaultKeyReplicationRegionsCommand({ReplicationRegions: regions}),
    )
    return res.EnabledReplicationRegions ?? []
}

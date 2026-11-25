import {
    AddKeyReplicationRegionsCommand,
    DisableDefaultKeyReplicationRegionsCommand,
    EnableDefaultKeyReplicationRegionsCommand,
    GetDefaultKeyReplicationRegionsCommand,
    RemoveKeyReplicationRegionsCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'

/**
 * The Regions a key is replicated to.
 *
 * <p>A key is replicated to the Regions it names, and the Regions it no longer
 * names are taken away. A replica is read-only, so the Regions of a replica are
 * the ones its primary holds.
 */
export async function setReplicationRegions(
    client: PaymentCryptographyClient,
    keyArn: string,
    regions: string[],
    add: boolean,
): Promise<void> {
    // The reference's own commands name the Regions they change, so a list
    // that names no Region is not a request the service can act on. The helper
    // is exported, so it does not leave the check to every caller.
    if (regions.length === 0) return
    const command = add
        ? new AddKeyReplicationRegionsCommand({KeyIdentifier: keyArn, ReplicationRegions: regions})
        : new RemoveKeyReplicationRegionsCommand({KeyIdentifier: keyArn, ReplicationRegions: regions})
    await client.send(command)
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

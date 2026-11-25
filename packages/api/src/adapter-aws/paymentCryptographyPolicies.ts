import {
    DeleteResourcePolicyCommand,
    GetResourcePolicyCommand,
    PutResourcePolicyCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {ValidationError} from '../cloud-spi/errors'
import {isNotFound} from './paymentCryptographyErrors'

/** The prefix the ARN of a payment cryptography key carries. */
const KEY_ARN_PREFIX = 'arn:aws:payment-cryptography:'

/**
 * The policy of a key, and whether the lookup of it failed.
 *
 * <p>A key that holds no policy is not the same as a key whose policy cannot be
 * read, so the two are told apart here rather than by the caller. A lookup that
 * failed carries no policy: the two cannot happen at once, so the type says so
 * and a policy that was read cannot be dropped by a caller that answers both.
 */
export type KeyPolicyLookup =
    | {policy: string; unavailable?: false}
    | {policy: null; unavailable?: false}
    | {policy: null; unavailable: true; reason?: string}

/**
 * The resource-based policy of a key, which is what lets another account use it.
 *
 * <p>The policy is enrichment: a key whose policy cannot be read is still a key,
 * so a denial or a throttle is reported rather than thrown, and the key stays on
 * screen. A key that holds no policy answers a policy of null, and so does a key
 * that is not there.
 */
export async function getKeyPolicy(
    client: PaymentCryptographyClient,
    keyArn: string,
): Promise<KeyPolicyLookup> {
    // The service's ResourceArn takes a full key ARN. The key behind this call
    // is resolved by GetKeyCommand, whose KeyIdentifier accepts an ARN, an
    // alias name or a short key id, so a caller that hands the identifier over
    // would be refused with an InvalidArnException and the policy of a readable
    // key would be published as unreadable.
    if (!keyArn.startsWith(KEY_ARN_PREFIX)) {
        throw new ValidationError(`the policy of a key is read by the ARN of the key, not by ${keyArn}`)
    }
    try {
        const res = await client.send(new GetResourcePolicyCommand({ResourceArn: keyArn}))
        const policy = res.Policy ?? null
        // A key that holds a policy and a key that holds none are two states,
        // and the type says so.
        return policy === null ? {policy: null} : {policy}
    } catch (error) {
        if (isNotFound(error)) return {policy: null}
        // The refusal says nothing of the policy the key holds, so it is reported
        // as unreadable rather than taken for one that is not there. The reason
        // is kept, so a throttle is told apart from a denial and a request the
        // service refused as malformed is not passed off as an unreadable
        // policy.
        return {
            policy: null,
            unavailable: true,
            reason: error instanceof Error ? error.name : 'unknown',
        }
    }
}

/**
 * Attaches a policy to a key, or replaces the one it holds.
 *
 * <p>The reference refuses a policy that grants public access, and says so.
 */
export async function putKeyPolicy(
    client: PaymentCryptographyClient,
    keyArn: string,
    policy: string,
): Promise<void> {
    await client.send(new PutResourcePolicyCommand({ResourceArn: keyArn, Policy: policy}))
}

/**
 * Removes the policy of a key.
 *
 * <p>A key that holds no policy is a key whose policy is already gone, so the
 * removal has happened and the removal does not fail, the way the read path
 * takes a missing policy for none rather than for a policy it could not read.
 */
export async function deleteKeyPolicy(
    client: PaymentCryptographyClient,
    keyArn: string,
): Promise<void> {
    try {
        await client.send(new DeleteResourcePolicyCommand({ResourceArn: keyArn}))
    } catch (error) {
        if (isNotFound(error)) return
        throw error
    }
}

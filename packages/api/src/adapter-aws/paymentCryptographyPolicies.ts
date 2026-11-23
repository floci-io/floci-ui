import {
    DeleteResourcePolicyCommand,
    GetResourcePolicyCommand,
    PutResourcePolicyCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {isNotFound} from './paymentCryptographyErrors'

/**
 * The policy of a key, and whether the lookup of it failed.
 *
 * <p>A key that holds no policy is not the same as a key whose policy cannot be
 * read, so the two are told apart here rather than by the caller.
 */
export type KeyPolicyLookup = {policy: string | null; unavailable?: true}

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
    try {
        const res = await client.send(new GetResourcePolicyCommand({ResourceArn: keyArn}))
        return {policy: res.Policy ?? null}
    } catch (error) {
        if (isNotFound(error)) return {policy: null}
        // The refusal says nothing of the policy the key holds, so it is reported
        // as unreadable rather than taken for one that is not there.
        return {policy: null, unavailable: true}
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

/** Removes the policy of a key. */
export async function deleteKeyPolicy(
    client: PaymentCryptographyClient,
    keyArn: string,
): Promise<void> {
    await client.send(new DeleteResourcePolicyCommand({ResourceArn: keyArn}))
}

import {
    DeleteResourcePolicyCommand,
    GetResourcePolicyCommand,
    PutResourcePolicyCommand,
    type PaymentCryptographyClient,
} from '@aws-sdk/client-payment-cryptography'
import {isNotFound} from './paymentCryptographyErrors'

/**
 * The resource-based policy of a key, which is what lets another account use it.
 *
 * <p>A key without one has no policy, which is not the same as a key whose policy
 * cannot be read, so a key that is not there answers null as well.
 */
export async function getKeyPolicy(
    client: PaymentCryptographyClient,
    keyArn: string,
): Promise<string | null> {
    try {
        const res = await client.send(new GetResourcePolicyCommand({ResourceArn: keyArn}))
        return res.Policy ?? null
    } catch (error) {
        if (isNotFound(error)) return null
        throw error
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

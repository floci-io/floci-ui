/**
 * Decides whether a SQL data connection may drop TLS.
 *
 * The host is not configuration: it comes from `metadata.endpoint.address` on the
 * resource the runtime returned, so a compromised or misconfigured runtime can point
 * these clients anywhere. Since the panel sends real administrator credentials, the
 * insecure settings a local emulator needs are granted only to a loopback address and
 * every other host gets verified TLS.
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '[::1]'])

export function isLoopbackSqlHost(host: string): boolean {
    const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
    if (LOOPBACK_HOSTNAMES.has(normalized) || LOOPBACK_HOSTNAMES.has(`[${normalized}]`)) return true
    // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
}

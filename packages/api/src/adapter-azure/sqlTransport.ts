const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '[::1]'])

export type SqlTlsMode = 'disable' | 'trust-server-certificate' | 'verify'

export function isLoopbackSqlHost(host: string): boolean {
    const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
    if (LOOPBACK_HOSTNAMES.has(normalized) || LOOPBACK_HOSTNAMES.has(`[${normalized}]`)) return true
    // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
}

export function azureSqlTlsMode(
    host: string,
    minimalTlsVersion: string | null,
    hasLocalPort: boolean,
): SqlTlsMode {
    if (isLoopbackSqlHost(host)) return 'disable'
    if (hasLocalPort && minimalTlsVersion?.trim().toLowerCase() === 'none') return 'trust-server-certificate'
    return 'verify'
}

export function postgresTlsMode(host: string, hasLocalPort: boolean): SqlTlsMode {
    if (isLoopbackSqlHost(host) || hasLocalPort) return 'disable'
    return 'verify'
}

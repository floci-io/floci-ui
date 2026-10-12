/**
 * Cross-cloud network validation utilities.
 * CIDR and port logic applies equally to AWS VPCs, Azure VNets, GCP VPCs, OCI VCNs, etc.
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

const CIDR_RE = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/

function parseIpAndPrefix(cidr: string): [number[], number] | null {
  const m = cidr.trim().match(CIDR_RE)
  if (!m) return null
  const octs = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  const prefix = Number(m[5])
  if (octs.some((o) => o > 255) || prefix > 32) return null
  return [octs, prefix]
}

/** Zero out host bits of an IP array up to the given prefix length. */
function maskIp(octs: number[], prefix: number): number[] {
  const result = [...octs]
  let bits = prefix
  for (let i = 0; i < 4; i++) {
    if (bits >= 8) {
      bits -= 8
    } else if (bits > 0) {
      result[i] = result[i] & ((0xff << (8 - bits)) & 0xff)
      bits = 0
    } else {
      result[i] = 0
    }
  }
  return result
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/** True when `cidr` is a syntactically valid IPv4 CIDR (e.g. 10.0.0.0/16). */
export function isValidCidr(cidr: string): boolean {
  return parseIpAndPrefix(cidr) !== null
}

/**
 * True when `innerCidr` fits entirely inside `outerCidr`.
 *
 * Conditions:
 *   1. Both must be valid CIDRs.
 *   2. inner prefix >= outer prefix (inner block cannot be larger than outer).
 *   3. inner's network address, masked to the outer prefix, equals outer's
 *      network address — confirming inner is actually inside the outer range.
 *
 * Example: 10.0.1.0/24 is within 10.0.0.0/16. 10.1.0.0/24 is not.
 */
export function isCidrWithinBlock(innerCidr: string, outerCidr: string): boolean {
  const inner = parseIpAndPrefix(innerCidr)
  const outer = parseIpAndPrefix(outerCidr)
  if (!inner || !outer) return false

  const [innerOcts, innerPrefix] = inner
  const [outerOcts, outerPrefix] = outer

  if (innerPrefix < outerPrefix) return false

  const innerMasked = maskIp(innerOcts, outerPrefix)
  const outerMasked = maskIp(outerOcts, outerPrefix)

  return innerMasked.every((b, i) => b === outerMasked[i])
}

/** True when `port` is an integer in [0, 65535]. */
export function isValidPort(port: string): boolean {
  const n = Number(port)
  return Number.isInteger(n) && n >= 0 && n <= 65535
}

/**
 * True when fromPort <= toPort and both are valid.
 * Always true for protocols that don't use ports ('-1', 'icmp').
 */
export function isValidPortRange(protocol: string, from: string, to: string): boolean {
  if (protocol === '-1' || protocol === 'icmp') return true
  if (!isValidPort(from) || !isValidPort(to)) return false
  return Number(from) <= Number(to)
}

// ─── Subnet group CIDR calculation ───────────────────────────────────────────

export type SubnetGroupDef = {
  name: string
  count: number
  isPublic: boolean
  /** Subnet prefix length override, e.g. 24 for /24. Defaults to min(vpcPrefix+4, 28). */
  prefix?: number
}

export type SubnetGroupPreview = {
  name: string
  isPublic: boolean
  cidrs: string[]
}

/**
 * Allocates non-overlapping subnet CIDRs for each named group sequentially.
 * subnetPrefix = min(vpcPrefix + 4, 28). Groups are laid out in declaration
 * order without gaps — suitable for both the wizard preview and the backend.
 *
 * Example: vpcCidr=10.0.0.0/16, groups=[{public,2},{private-app,2},{private-db,1}]
 *   public-1        = 10.0.0.0/20
 *   public-2        = 10.0.16.0/20
 *   private-app-1   = 10.0.32.0/20
 *   private-app-2   = 10.0.48.0/20
 *   private-db-1    = 10.0.64.0/20
 */
export function calculateSubnetCidrs(
  vpcCidr: string,
  groups: SubnetGroupDef[],
): SubnetGroupPreview[] {
  const parsed = parseIpAndPrefix(vpcCidr)
  if (!parsed) return groups.map((g) => ({ name: g.name, isPublic: g.isPublic, cidrs: [] }))

  const [octs, vpcPrefix] = parsed
  const vpcBase = octs[0] * 16777216 + octs[1] * 65536 + octs[2] * 256 + octs[3]
  const defaultPrefix = Math.min(vpcPrefix + 4, 28)

  function baseToCidr(base: number, prefix: number): string {
    return (
      `${Math.floor(base / 16777216)}.` +
      `${Math.floor((base % 16777216) / 65536)}.` +
      `${Math.floor((base % 65536) / 256)}.` +
      `${base % 256}/${prefix}`
    )
  }

  let currentBase = vpcBase
  return groups.map((g) => {
    const prefix = g.prefix ?? defaultPrefix
    const size = Math.pow(2, 32 - prefix)
    const cidrs = Array.from({ length: g.count }, (_, i) => baseToCidr(currentBase + i * size, prefix))
    currentBase += g.count * size
    return { name: g.name, isPublic: g.isPublic, cidrs }
  })
}

/**
 * True when every generated subnet fits inside the requested VPC block.
 * The wizard checks this before sending any provisioning request because the
 * allocator lays groups out sequentially and can run past a small VPC.
 */
export function isSubnetLayoutWithinBlock(vpcCidr: string, groups: SubnetGroupDef[]): boolean {
  const parsed = parseIpAndPrefix(vpcCidr)
  if (!parsed || !isCanonicalCidr(vpcCidr) || groups.length === 0) return false

  const vpcPrefix = parsed[1]
  if (vpcPrefix < 16 || vpcPrefix > 28) return false
  let allocatedSize = 0
  if (groups.some((group) => {
    const prefix = group.prefix ?? Math.min(vpcPrefix + 4, 28)
    if (!Number.isInteger(group.count) || group.count < 1 || !Number.isInteger(prefix) || prefix < vpcPrefix || prefix > 28) return true
    allocatedSize += group.count * Math.pow(2, 32 - prefix)
    return allocatedSize > Math.pow(2, 32 - vpcPrefix)
  })) return false

  const previews = calculateSubnetCidrs(vpcCidr, groups)
  return previews.every((group) => group.cidrs.every((cidr) => isCanonicalCidr(cidr) && isCidrWithinBlock(cidr, vpcCidr)))
}

function isCanonicalCidr(cidr: string): boolean {
  const parsed = parseIpAndPrefix(cidr)
  if (!parsed) return false
  const [octets, prefix] = parsed
  const masked = maskIp(octets, prefix)
  return octets.every((octet, index) => octet === masked[index])
}

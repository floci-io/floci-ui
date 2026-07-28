/**
 * Minimal ZIP writer for Lambda deployment packages.
 *
 * `CreateFunction`'s `Code.ZipFile` must be a real ZIP archive — passing raw
 * source text makes the runtime reject the call with "Handler file not found in
 * deployment package". Nothing in the dependency tree can build one, and the
 * archives here are a single small source file, so entries are written with the
 * STORED method (no compression): that needs only a CRC-32 and keeps this to a
 * format-exact, dependency-free implementation.
 *
 * Spec: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local header), 4.3.12 (central
 * directory) and 4.3.16 (end of central directory).
 */

const CRC32_TABLE = buildCrc32Table()

function buildCrc32Table(): Uint32Array {
    const table = new Uint32Array(256)
    for (let i = 0; i < 256; i += 1) {
        let value = i
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
        }
        table[i] = value >>> 0
    }
    return table
}

export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
    name: string
    content: string | Uint8Array
}

/** Build a ZIP archive containing the given files, stored uncompressed. */
export function createZipArchive(entries: ZipEntry[]): Uint8Array {
    const encoder = new TextEncoder()
    const localParts: Uint8Array[] = []
    const centralParts: Uint8Array[] = []
    let offset = 0
    let localSize = 0

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name)
        const data = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content
        const checksum = crc32(data)

        const localHeader = new Uint8Array(30 + nameBytes.length)
        const localView = new DataView(localHeader.buffer)
        localView.setUint32(0, 0x04034b50, true) // local file header signature
        localView.setUint16(4, 20, true) // version needed to extract (2.0)
        localView.setUint16(6, 0, true) // general purpose bit flag
        localView.setUint16(8, 0, true) // compression method: STORED
        localView.setUint16(10, 0, true) // last mod time — fixed for reproducibility
        localView.setUint16(12, 0x0021, true) // last mod date: 1980-01-01, the epoch ZIP allows
        localView.setUint32(14, checksum, true)
        localView.setUint32(18, data.length, true) // compressed size
        localView.setUint32(22, data.length, true) // uncompressed size
        localView.setUint16(26, nameBytes.length, true)
        localView.setUint16(28, 0, true) // extra field length
        localHeader.set(nameBytes, 30)

        const centralHeader = new Uint8Array(46 + nameBytes.length)
        const centralView = new DataView(centralHeader.buffer)
        centralView.setUint32(0, 0x02014b50, true) // central directory signature
        centralView.setUint16(4, 20, true) // version made by
        centralView.setUint16(6, 20, true) // version needed to extract
        centralView.setUint16(8, 0, true)
        centralView.setUint16(10, 0, true) // STORED
        centralView.setUint16(12, 0, true)
        centralView.setUint16(14, 0x0021, true)
        centralView.setUint32(16, checksum, true)
        centralView.setUint32(20, data.length, true)
        centralView.setUint32(24, data.length, true)
        centralView.setUint16(28, nameBytes.length, true)
        centralView.setUint16(30, 0, true) // extra field length
        centralView.setUint16(32, 0, true) // file comment length
        centralView.setUint16(34, 0, true) // disk number start
        centralView.setUint16(36, 0, true) // internal file attributes
        centralView.setUint32(38, 0o100644 << 16, true) // external attrs: regular file, rw-r--r--
        centralView.setUint32(42, offset, true) // relative offset of local header
        centralHeader.set(nameBytes, 46)

        localParts.push(localHeader, data)
        centralParts.push(centralHeader)
        offset += localHeader.length + data.length
        localSize += localHeader.length + data.length
    }

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
    const endRecord = new Uint8Array(22)
    const endView = new DataView(endRecord.buffer)
    endView.setUint32(0, 0x06054b50, true) // end of central directory signature
    endView.setUint16(4, 0, true) // this disk number
    endView.setUint16(6, 0, true) // disk with central directory
    endView.setUint16(8, entries.length, true)
    endView.setUint16(10, entries.length, true)
    endView.setUint32(12, centralSize, true)
    endView.setUint32(16, localSize, true) // central directory offset
    endView.setUint16(20, 0, true) // comment length

    return concat([...localParts, ...centralParts, endRecord])
}

function concat(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(total)
    let cursor = 0
    for (const part of parts) {
        out.set(part, cursor)
        cursor += part.length
    }
    return out
}

/**
 * Derive the deployment-package filename Lambda will look for from a handler
 * string. `index.handler` means the exported `handler` lives in `index.js`;
 * `src/app.run` means `run` lives in `src/app.js`.
 */
export function handlerFileName(handler: string, runtime: string): string {
    const modulePath = handler.split('.').slice(0, -1).join('.') || 'index'
    const extension = runtime.startsWith('python') ? 'py' : runtime.startsWith('ruby') ? 'rb' : 'js'
    return `${modulePath}.${extension}`
}

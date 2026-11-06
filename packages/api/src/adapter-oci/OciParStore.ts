import type {ChildItem, CollectionPage, ItemStoreAdapter, PageQuery} from '../cloud-spi/childCollections'
import {ValidationError} from '../cloud-spi/errors'
import type {OciRuntimeClient} from '../oci'

export const PAR_ACCESS_TYPES = [
    'ObjectRead',
    'ObjectWrite',
    'ObjectReadWrite',
    'AnyObjectRead',
    'AnyObjectWrite',
    'AnyObjectReadWrite',
] as const

type ParAccessType = typeof PAR_ACCESS_TYPES[number]

interface OciPar {
    id?: string
    name?: string
    accessType?: string
    objectName?: string
    timeCreated?: string
    timeExpires?: string
    accessUri?: string
    fullPath?: string
}

/**
 * Pre-authenticated requests of a bucket. The access URI is returned by
 * CreatePreauthenticatedRequest only, as in the real service, so listing never
 * surfaces it even though Floci-OCI repeats `fullPath` in the list.
 */
export class OciParStore implements ItemStoreAdapter {
    constructor(
        private readonly client: OciRuntimeClient,
        private readonly bucketPath: (bucket: string) => Promise<string>,
    ) {}

    async listItems(bucket: string, _page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const pars = await this.client.listAll<OciPar>(`${await this.parsPath(bucket)}`)
        return {items: pars.map((par) => toItem(par, false)), nextCursor: null}
    }

    async putItem(bucket: string, body: Record<string, unknown>): Promise<ChildItem> {
        const details = parseCreate(body)
        const created = await this.client.json<OciPar>(await this.parsPath(bucket), {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(details),
        })
        return toItem(created ?? {}, true)
    }

    async deleteItem(bucket: string, parId: string): Promise<void> {
        await this.client.fetch(
            `${await this.parsPath(bucket)}/${encodeURIComponent(parId)}`,
            {method: 'DELETE'},
            {emptyOnNotFound: true},
        )
    }

    private async parsPath(bucket: string): Promise<string> {
        return `${await this.bucketPath(bucket)}/p`
    }
}

interface CreateDetails {
    name: string
    accessType: ParAccessType
    timeExpires: string
    objectName?: string
}

/** Floci-OCI accepts a past expiry and an object access type without an object; the real service rejects both. */
function parseCreate(body: Record<string, unknown>): CreateDetails {
    const name = text(body.name)
    if (!name) throw new ValidationError('name is required')

    const accessType = text(body.accessType)
    if (!isAccessType(accessType)) {
        throw new ValidationError(`accessType must be one of ${PAR_ACCESS_TYPES.join(', ')}`)
    }

    const expires = text(body.timeExpires)
    if (!expires) throw new ValidationError('timeExpires is required')
    const expiresAt = Date.parse(expires)
    if (Number.isNaN(expiresAt)) throw new ValidationError('timeExpires must be a valid date and time')
    if (expiresAt <= Date.now()) throw new ValidationError('timeExpires must be in the future')

    // Object keys are exact: spaces at the edges are part of the name, so it is never trimmed.
    const rawObject = typeof body.objectName === 'string' ? body.objectName : ''
    const objectName = rawObject.trim() ? rawObject : ''
    if (accessType.startsWith('Object') && !objectName) {
        throw new ValidationError(`objectName is required for access type ${accessType}`)
    }
    if (accessType.startsWith('Any') && objectName) {
        throw new ValidationError(`objectName is only valid for object access types, not ${accessType}`)
    }

    return {
        name,
        accessType,
        timeExpires: new Date(expiresAt).toISOString(),
        ...(objectName ? {objectName} : {}),
    }
}

function toItem(par: OciPar, includeAccess: boolean): ChildItem {
    return {
        id: par.id ?? par.name ?? '',
        collectionId: null,
        timestamp: par.timeCreated ?? null,
        body: {
            name: par.name,
            accessType: par.accessType,
            objectName: par.objectName,
            timeExpires: par.timeExpires,
            ...(includeAccess ? {accessUri: par.accessUri, fullPath: par.fullPath} : {}),
        },
        metadata: {provider: 'oci', storageService: 'object-storage'},
    }
}

function isAccessType(value: string): value is ParAccessType {
    return (PAR_ACCESS_TYPES as readonly string[]).includes(value)
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

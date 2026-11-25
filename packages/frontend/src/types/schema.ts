import type {CloudProvider, CloudServiceType} from './cloud'

export type FieldType = 'text' | 'textarea' | 'password' | 'select'
export type ActionSchema = 'list' | 'create' | 'update' | 'delete' | 'inspect'
// Mirrors packages/api/src/cloud-spi/types.ts. Lifecycle verbs can be advertised
// in a capability block even though they are not table-level controls.
export type ResourceActionName =
    | 'list'
    | 'create'
    | 'update'
    | 'delete'
    | 'inspect'
    | 'encrypt'
    | 'decrypt'
    | 'invoke'
    | 'start'
    | 'stop'
    | 'reboot'
    | 'updateTags'
    | 'sendMessage'
    | 'receiveMessages'
    | 'deleteMessage'
    | 'purgeQueue'
    | 'putMessages'
    | 'readMessages'
    | 'emptyBucket'
export type ObjectActionName = 'list' | 'upload' | 'download' | 'delete' | 'createFolder' | 'copy'
export type DatabaseActionName = 'listSnapshots' | 'createSnapshot'
export type KubernetesActionName =
    | 'listNodegroups'
    | 'createNodegroup'
    | 'deleteNodegroup'
    | 'listFargateProfiles'
    | 'createFargateProfile'
    | 'deleteFargateProfile'
export type CapabilityStatus = 'available' | 'blocked' | 'partial' | 'coming_soon'

export interface CapabilitySchema<TAction extends string> {
    name: TAction
    label: string
    enabled: boolean
    status: CapabilityStatus
    reason?: string
    runtimeRequired?: boolean
    /**
     * The kinds of resource the capability does not apply to, named by the type
     * their rows carry. Mirrors packages/api/src/cloud-spi/types.ts.
     */
    excludedTypes?: string[]
}

/** Holds when the named field equals `equals`, or when it differs from `notEquals`. Set one of them. */
export interface FieldCondition {
    field: string
    equals?: string
    notEquals?: string
}

/**
 * The discriminators a service publishes a pairing rule under.
 *
 * <p>The console reads one value, so a rule under another one is not read at
 * all and the console offers nothing rather than every pairing.
 */
export type PairingDiscriminator = 'keyAlgorithm'

/**
 * A rule a service publishes about what may carry what, for a panel that has to
 * offer only the pairings the service allows.
 */
export interface PairingRule {
    /** The metadata member that says what the resource is, such as its algorithm. */
    discriminator: PairingDiscriminator
    /** What it may carry, by that member's value. */
    allowed: Readonly<Record<string, readonly string[]>>
}

export interface FieldSchema {
    name: string
    label: string
    type: FieldType
    required: boolean
    requiredWhen?: FieldCondition
    description?: string
    group?: string
    span?: boolean
    valuePath?: string
    defaultValue?: string
    visibleWhen?: FieldCondition
    validation?: {
        pattern?: string
        minLength?: number
        maxLength?: number
        maxLengthWhen?: {field: string; equals: string; value: number; message?: string}
        message?: string
    }
    options?: Array<{
        label: string
        value: string
        /** What the form makes when this option is the one picked. */
        submitLabel?: string
    }>
    /**
     * The kind of resource whose rows become the options, for a field that names
     * another resource of the same service.
     */
    optionsFrom?: string
    /**
     * The published state of a row that makes it an option of this field.
     *
     * <p>A field that names another resource of the same service offers every
     * row of that kind by default. A field that may name only some of them says
     * which state the service published, so the choices are the ones the service
     * allows rather than the ones the console worked out for itself.
     */
    optionsState?: string
    /**
     * The member of a row's metadata that carries the name the operator knows
     * the resource by.
     *
     * <p>A row's own name is not always what an operator would call it: a
     * payment key is known by the alias that names it, and an ARN is not
     * something an operator remembers.
     */
    optionsLabelFrom?: string
}

export type ColumnFormat = 'text' | 'datetime' | 'relative' | 'bytes' | 'boolean' | 'badge' | 'code' | 'list'

export interface TableColumnSchema {
    name: string
    label: string
    /** Dotted accessor, defaulting to `name`; needed to reach `metadata.*`. */
    path?: string
    format?: ColumnFormat
    emptyText?: string
    width?: string
}

export interface ServiceSchema {
    cloud: CloudProvider
    service: CloudServiceType
    displayName: string
    fields: FieldSchema[]
    actions: ActionSchema[]
    capabilities?: {
        resourceActions?: Array<CapabilitySchema<ResourceActionName> | ResourceActionName>
        objectActions?: Array<CapabilitySchema<ObjectActionName> | ObjectActionName>
        databaseActions?: Array<CapabilitySchema<DatabaseActionName> | DatabaseActionName>
        kubernetesActions?: Array<CapabilitySchema<KubernetesActionName> | KubernetesActionName>
    }
    filters: FieldSchema[]
    columns: TableColumnSchema[]
    updateFields?: FieldSchema[]
    /**
     * The pairings the service allows, for a panel that chooses one resource to
     * carry another. At most one rule per discriminator: a consumer that asks
     * for a discriminator takes the first rule that names it.
     */
    pairings?: PairingRule[]
    notice?: string
}

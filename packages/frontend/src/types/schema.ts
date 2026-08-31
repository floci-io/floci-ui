import type {CloudProvider, CloudServiceType} from './cloud'

export type FieldType = 'text' | 'password' | 'select'
export type ActionSchema = 'list' | 'create' | 'delete' | 'inspect'
// Mirrors packages/api/src/cloud-spi/types.ts. Lifecycle verbs can be advertised
// in a capability block even though they are not table-level controls.
export type ResourceActionName =
    | 'list'
    | 'create'
    | 'delete'
    | 'inspect'
    | 'invoke'
    | 'start'
    | 'stop'
    | 'reboot'
    | 'updateTags'
export type ObjectActionName = 'list' | 'upload' | 'download' | 'delete' | 'createFolder' | 'copy'
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
}

export interface FieldSchema {
    name: string
    label: string
    type: FieldType
    required: boolean
    requiredWhen?: {field: string; equals: string}
    description?: string
    group?: string
    span?: boolean
    defaultValue?: string
    validation?: {
        pattern?: string
        minLength?: number
        maxLength?: number
        maxLengthWhen?: {field: string; equals: string; value: number; message?: string}
        message?: string
    }
    options?: Array<{label: string; value: string}>
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
        kubernetesActions?: Array<CapabilitySchema<KubernetesActionName> | KubernetesActionName>
    }
    filters: FieldSchema[]
    columns: TableColumnSchema[]
}

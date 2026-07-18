import type {CloudProvider, CloudServiceType} from './cloud'

export type FieldType = 'text' | 'password' | 'select'
export type ActionSchema = 'list' | 'create' | 'delete' | 'inspect'
export type ResourceActionName = 'list' | 'create' | 'delete' | 'inspect'
export type ObjectActionName = 'list' | 'upload' | 'download' | 'delete' | 'createFolder' | 'copy'
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
    description?: string
    group?: string
    span?: boolean
    validation?: {
        pattern?: string
        minLength?: number
        maxLength?: number
        message?: string
    }
    options?: Array<{label: string; value: string}>
}

export interface TableColumnSchema {
    name: string
    label: string
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
    }
    filters: FieldSchema[]
    columns: TableColumnSchema[]
}

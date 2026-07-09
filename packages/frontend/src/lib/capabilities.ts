import type {CapabilitySchema, CapabilityStatus, ObjectActionName, ResourceActionName} from '@/types/schema'
import type {CloudAvailability} from '@/types/cloud'

export type CapabilityActionName = ResourceActionName | ObjectActionName
export type AnyCapability = CapabilitySchema<CapabilityActionName>
export type CapabilityInput<TAction extends CapabilityActionName> = CapabilitySchema<TAction> | TAction

const actionLabels: Record<CapabilityActionName, string> = {
    list: 'List',
    create: 'Create',
    delete: 'Delete',
    inspect: 'Inspect',
    upload: 'Upload',
    download: 'Download',
    createFolder: 'Create folder',
    copy: 'Copy object',
}

export function normalizeCapabilities<TAction extends CapabilityActionName>(capabilities: Array<CapabilityInput<TAction>> = []): Array<CapabilitySchema<TAction>> {
    return capabilities.map((capability) => {
        if (typeof capability !== 'string') return capability
        return {
            name: capability,
            label: actionLabels[capability],
            enabled: true,
            status: 'available' as CapabilityStatus,
            runtimeRequired: true,
        }
    })
}

export function capabilityFor<TAction extends CapabilityActionName>(capabilities: Array<CapabilitySchema<TAction>>, name: TAction): CapabilitySchema<TAction> | undefined {
    return capabilities.find((capability) => capability.name === name)
}

export function capabilityEnabled(capability: CapabilitySchema<CapabilityActionName> | undefined): boolean {
    return Boolean(capability?.enabled && capability.status !== 'blocked' && capability.status !== 'coming_soon')
}

export function withRuntimeState<TAction extends CapabilityActionName>(
    capabilities: Array<CapabilitySchema<TAction>>,
    runtimeReachable: boolean,
): Array<CapabilitySchema<TAction>> {
    return capabilities.map((capability) => {
        if (runtimeReachable || !capability.runtimeRequired) return capability
        return {
            ...capability,
            enabled: false,
            status: 'blocked',
            reason: 'Start the selected runtime before using this action.',
        }
    })
}

export function withServiceAvailability<TAction extends CapabilityActionName>(
    capabilities: Array<CapabilitySchema<TAction>>,
    serviceAvailability: CloudAvailability,
): Array<CapabilitySchema<TAction>> {
    if (serviceAvailability === 'available') return capabilities
    return capabilities.map((capability) => ({
        ...capability,
        enabled: false,
        status: 'coming_soon' as CapabilityStatus,
        reason: 'This provider service schema is available, but no runtime adapter is registered yet.',
    }))
}

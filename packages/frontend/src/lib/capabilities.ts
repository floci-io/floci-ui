import type {CapabilitySchema, CapabilityStatus, DatabaseActionName, KubernetesActionName, ObjectActionName, ResourceActionName} from '@/types/schema'
import type {CloudAvailability} from '@/types/cloud'

export type CapabilityActionName = ResourceActionName | ObjectActionName | KubernetesActionName | DatabaseActionName
export type AnyCapability = CapabilitySchema<CapabilityActionName>
export type CapabilityInput<TAction extends CapabilityActionName> = CapabilitySchema<TAction> | TAction

const actionLabels: Record<CapabilityActionName, string> = {
    list: 'List',
    create: 'Create',
    update: 'Update',
    delete: 'Delete',
    inspect: 'Inspect',
    encrypt: 'Encrypt',
    decrypt: 'Decrypt',
    upload: 'Upload',
    download: 'Download',
    createFolder: 'Create folder',
    copy: 'Copy object',
    invoke: 'Invoke',
    start: 'Start',
    stop: 'Stop',
    reboot: 'Reboot',
    updateTags: 'Edit tags',
    listSnapshots: 'List DB snapshots',
    createSnapshot: 'Create DB snapshot',
    listNodegroups: 'List nodegroups',
    createNodegroup: 'Create nodegroup',
    deleteNodegroup: 'Delete nodegroup',
    listFargateProfiles: 'List Fargate profiles',
    createFargateProfile: 'Create Fargate profile',
    deleteFargateProfile: 'Delete Fargate profile',
    sendMessage: 'Send message',
    receiveMessages: 'Receive messages',
    deleteMessage: 'Delete message',
    purgeQueue: 'Purge queue',
    putMessages: 'Put messages',
    readMessages: 'Read messages',
    emptyBucket: 'Empty bucket',
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

/**
 * Whether a capability applies to a resource of this type.
 *
 * <p>A service can hold kinds of resource that do not take the same actions: the
 * schema names the kinds a capability does not apply to, and the control is
 * hidden for those. A resource of an unnamed kind is one the capability does
 * apply to, because only the named kinds are excluded.
 */
export function capabilityAppliesToType(
    capability: CapabilitySchema<CapabilityActionName> | undefined,
    resourceType: string | undefined,
): boolean {
    if (!capability) return false
    if (!resourceType) return true
    return !(capability.excludedTypes ?? []).includes(resourceType)
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

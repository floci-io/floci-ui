import {
    Boxes,
    Circle,
    Database,
    HardDrive,
    KeyRound,
    Layers,
    Lock,
    MessageSquare,
    Network,
    Radio,
    ScrollText,
    Scale,
    Server,
    ShieldCheck,
    SlidersHorizontal,
    Table2,
    Workflow,
    Waypoints,
    Zap,
    type LucideIcon,
} from 'lucide-react'

/**
 * Maps the server's `iconKey` hint to a component.
 *
 * Icon keys are additive and never load-bearing: the server can ship a service
 * whose key this build has never heard of, and the nav must still render. Passing
 * `undefined` as a JSX component throws and — before the ErrorBoundary lands —
 * would blank the whole app, so the fallback is not optional.
 */
const SERVICE_ICONS: Record<string, LucideIcon> = {
    storage: HardDrive,
    database: Table2,
    nosql: Database,
    k8s: Boxes,
    compute: Server,
    containers: Boxes,
    networking: Network,
    apigateway: Waypoints,
    serverless: Zap,
    secrets: KeyRound,
    iac: Layers,
    messaging: MessageSquare,
    events: Radio,
    email: MessageSquare,
    queue: MessageSquare,
    logs: ScrollText,
    iam: ShieldCheck,
    kms: Lock,
    loadbalancing: Scale,
    parameters: SlidersHorizontal,
    workflows: Workflow,
}

const FALLBACK_ICON: LucideIcon = Circle

export function serviceIcon(iconKey?: string): LucideIcon {
    return (iconKey && SERVICE_ICONS[iconKey]) || FALLBACK_ICON
}

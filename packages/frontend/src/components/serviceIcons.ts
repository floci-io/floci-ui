import {
    Boxes,
    Circle,
    Database,
    HardDrive,
    KeyRound,
    Lock,
    MessageSquare,
    Network,
    ScrollText,
    Server,
    ShieldCheck,
    SlidersHorizontal,
    Table2,
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
    serverless: Zap,
    secrets: KeyRound,
    messaging: MessageSquare,
    queue: MessageSquare,
    logs: ScrollText,
    iam: ShieldCheck,
    kms: Lock,
    parameters: SlidersHorizontal,
}

const FALLBACK_ICON: LucideIcon = Circle

export function serviceIcon(iconKey?: string): LucideIcon {
    return (iconKey && SERVICE_ICONS[iconKey]) || FALLBACK_ICON
}

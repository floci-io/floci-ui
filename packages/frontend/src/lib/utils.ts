import {type ClassValue, clsx} from 'clsx'
import {twMerge} from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatNumber(value: number | undefined): string {
    return new Intl.NumberFormat().format(value ?? 0)
}

export function formatLatency(value: number | undefined): string {
    if (value == null || value <= 0) return '-'
    return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
}

export function timeAgo(value?: string | number): string {
    if (!value) return '-'
    const ts = typeof value === 'number' ? value : new Date(value).getTime()
    if (!Number.isFinite(ts)) return '-'

    const diff = Math.max(0, Date.now() - ts)
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
}

export function macShortcut(): string {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
}

export function statusColor(status: string): string {
    if (status === 'healthy' || status === 'active' || status === 'OK') return 'text-green-400'
    if (status === 'degraded' || status === 'INSUFFICIENT_DATA') return 'text-yellow-400'
    if (status === 'unavailable' || status === 'ALARM') return 'text-red-400'
    return 'text-[#8d9cad]'
}

import {Component, ComponentType, lazy, ReactNode, Suspense} from 'react'
import {WarningAlt} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {EmptyState} from '@/components/EmptyState'
import {PageSkeleton} from '@/components/PageSkeleton'

/**
 * Wraps a service panel so its code loads with the first render instead of with the app
 * shell. The panel keeps its name and props at the call site; a page skeleton stands in while the
 * chunk is in flight. A chunk that
 * fails to load (a tab left open across an upgrade) shows a reload prompt in the panel's
 * place instead of unmounting the console.
 */
export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>) {
    const Panel = lazy(async () => ({default: await load()}))
    return function LazyPanel(props: P) {
        return (
            <ChunkErrorBoundary>
                <Suspense fallback={<PageSkeleton/>}>
                    <Panel {...props}/>
                </Suspense>
            </ChunkErrorBoundary>
        )
    }
}

class ChunkErrorBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
    state = {failed: false}

    static getDerivedStateFromError() {
        return {failed: true}
    }

    render() {
        if (!this.state.failed) return this.props.children
        return (
            <EmptyState compact reason="error" icon={WarningAlt} title="This part of the console could not load" description="The console may have been updated since this page was opened."><Button variant="secondary" type="button" onClick={() => window.location.reload()}>Reload</Button></EmptyState>
        )
    }
}

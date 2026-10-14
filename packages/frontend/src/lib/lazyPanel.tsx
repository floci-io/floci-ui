import {Component, ComponentType, lazy, ReactNode, Suspense} from 'react'
import {AlertTriangle} from 'lucide-react'

/**
 * Wraps a service panel so its code loads with the first render instead of with the app
 * shell. The panel keeps its name and props at the call site; nothing renders while the
 * chunk is in flight, the same as a panel still waiting on its first query. A chunk that
 * fails to load (a tab left open across an upgrade) shows a reload prompt in the panel's
 * place instead of unmounting the console.
 */
export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>) {
    const Panel = lazy(async () => ({default: await load()}))
    return function LazyPanel(props: P) {
        return (
            <ChunkErrorBoundary>
                <Suspense fallback={null}>
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
            <div className="empty compact" role="alert">
                <div className="empty-icon">
                    <AlertTriangle size={18}/>
                </div>
                <h2>This part of the console could not load</h2>
                <p>The console may have been updated since this page was opened.</p>
                <button className="button" type="button" onClick={() => window.location.reload()}>Reload</button>
            </div>
        )
    }
}

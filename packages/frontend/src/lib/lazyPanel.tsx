import {ComponentType, lazy, Suspense} from 'react'

/**
 * Wraps a service panel so its code loads with the first render instead of with the app
 * shell. The panel keeps its name and props at the call site; nothing renders while the
 * chunk is in flight, the same as a panel still waiting on its first query.
 */
export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>) {
    const Panel = lazy(async () => ({default: await load()}))
    return function LazyPanel(props: P) {
        return (
            <Suspense fallback={null}>
                <Panel {...props}/>
            </Suspense>
        )
    }
}

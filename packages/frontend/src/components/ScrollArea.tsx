import {
    createElement,
    type ElementType,
    type HTMLAttributes,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
} from 'react'
import {cn} from '@/lib/sodium/utils'

const MIN_THUMB = 28
const IDLE_MS = 900

interface ScrollAreaProps extends HTMLAttributes<HTMLElement> {
    /** The scrolling element: `main`, `nav` or a plain `div`. */
    as?: ElementType
    /** Placement of the box that holds the scroller and its thumb, such as `flex-1 min-h-0`. */
    wrapperClassName?: string
    children: ReactNode
}

/**
 * A vertical scroller whose bar draws over the content and only while it moves, so it never takes a column of width
 * and a page that scrolls does not sit narrower than one that does not. The platform bar is hidden; wheel, trackpad,
 * keyboard and touch scroll the element as usual, and the thumb can be dragged.
 */
export function ScrollArea({as = 'div', wrapperClassName, className, children, ...rest}: ScrollAreaProps) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const viewportRef = useRef<HTMLElement>(null)
    const thumbRef = useRef<HTMLDivElement>(null)
    const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const dragging = useRef<{startY: number; startTop: number} | null>(null)

    const update = useCallback(() => {
        const viewport = viewportRef.current
        const thumb = thumbRef.current
        if (!viewport || !thumb) return
        const {scrollTop, scrollHeight, clientHeight} = viewport
        if (scrollHeight <= clientHeight + 1) {
            thumb.style.display = 'none'
            return
        }
        const thumbHeight = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * clientHeight)
        const travel = clientHeight - thumbHeight
        const top = travel * (scrollTop / (scrollHeight - clientHeight))
        thumb.style.display = 'block'
        thumb.style.height = `${thumbHeight}px`
        thumb.style.transform = `translateY(${top}px)`
    }, [])

    const reveal = useCallback(() => {
        const wrapper = wrapperRef.current
        if (!wrapper) return
        wrapper.dataset.scrolling = ''
        clearTimeout(idleTimer.current)
        idleTimer.current = setTimeout(() => {
            if (!dragging.current) delete wrapper.dataset.scrolling
        }, IDLE_MS)
    }, [])

    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const onScroll = () => {
            update()
            reveal()
        }
        viewport.addEventListener('scroll', onScroll, {passive: true})
        const resize = new ResizeObserver(update)
        const watch = () => {
            resize.disconnect()
            resize.observe(viewport)
            for (const child of Array.from(viewport.children)) resize.observe(child)
        }
        watch()
        const mutations = new MutationObserver(() => {
            watch()
            update()
        })
        mutations.observe(viewport, {childList: true})
        update()
        return () => {
            viewport.removeEventListener('scroll', onScroll)
            resize.disconnect()
            mutations.disconnect()
            clearTimeout(idleTimer.current)
        }
    }, [update, reveal])

    function onThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        const viewport = viewportRef.current
        if (!viewport) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragging.current = {startY: event.clientY, startTop: viewport.scrollTop}
        reveal()
    }

    function onThumbPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const viewport = viewportRef.current
        const drag = dragging.current
        if (!viewport || !drag) return
        const {scrollHeight, clientHeight} = viewport
        const thumbHeight = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * clientHeight)
        const travel = clientHeight - thumbHeight
        if (travel <= 0) return
        viewport.scrollTop = drag.startTop + ((event.clientY - drag.startY) / travel) * (scrollHeight - clientHeight)
        reveal()
    }

    function onThumbPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
        dragging.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        reveal()
    }

    return (
        <div ref={wrapperRef} className={cn('overlay-scroll-box', wrapperClassName)}>
            {createElement(as, {...rest, ref: viewportRef, className: cn('overlay-scroll', className)}, children)}
            <div className="overlay-scroll-track" aria-hidden="true">
                <div
                    ref={thumbRef}
                    className="overlay-scroll-thumb"
                    onPointerDown={onThumbPointerDown}
                    onPointerMove={onThumbPointerMove}
                    onPointerUp={onThumbPointerUp}
                    onPointerCancel={onThumbPointerUp}
                />
            </div>
        </div>
    )
}

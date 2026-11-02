import {useEffect, useRef} from 'react'
import {cn} from '@/lib/sodium/utils'

const CELL = 3
const FRAME_MS = 1000 / 24
// 4x4 Bayer matrix: the threshold each cell must beat to be drawn, which turns a smooth field into an ordered dither.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/**
 * An animated ordered-dither field behind a header: a slow wave, denser toward the end of the row so the text on the
 * start side stays clear. Drawn on a canvas, paused off screen and in a hidden tab, and a single still frame when the
 * person asks for reduced motion.
 */
export function DitherBackdrop({className}: {className?: string}) {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = ref.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        let width = 0
        let height = 0
        let cols = 0
        let rows = 0
        let color = '#888'
        let raf = 0
        let last = 0
        let visible = true

        const readColor = () => {
            color = getComputedStyle(canvas).getPropertyValue('--line-control').trim() || '#888'
        }

        const resize = () => {
            const box = canvas.getBoundingClientRect()
            width = Math.max(1, Math.round(box.width))
            height = Math.max(1, Math.round(box.height))
            const dpr = Math.min(window.devicePixelRatio || 1, 2)
            canvas.width = Math.round(width * dpr)
            canvas.height = Math.round(height * dpr)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            cols = Math.ceil(width / CELL)
            rows = Math.ceil(height / CELL)
            draw(performance.now())
        }

        function draw(now: number) {
            ctx!.clearRect(0, 0, width, height)
            ctx!.fillStyle = color
            const time = reduced ? 0 : now / 1000
            for (let cy = 0; cy < rows; cy++) {
                const ny = cy / rows
                for (let cx = 0; cx < cols; cx++) {
                    const nx = cx / cols
                    const fade = Math.max(0, (nx - 0.38) / 0.62)
                    if (fade <= 0) continue
                    const wave = 0.5 + 0.5 * Math.sin(nx * 11 - time * 0.9 + Math.sin(ny * 5 + time * 0.5) * 1.6)
                    const level = fade * fade * (0.25 + 0.75 * wave)
                    if (level * 16 > BAYER[(cy & 3) * 4 + (cx & 3)] + 0.5) ctx!.fillRect(cx * CELL, cy * CELL, CELL - 1, CELL - 1)
                }
            }
        }

        const tick = (now: number) => {
            raf = requestAnimationFrame(tick)
            if (!visible || now - last < FRAME_MS) return
            last = now
            draw(now)
        }

        readColor()
        resize()
        const resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(canvas)
        const themeObserver = new MutationObserver(() => {
            readColor()
            draw(performance.now())
        })
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']})
        const intersection = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting
        })
        intersection.observe(canvas)
        const onVisibility = () => {
            visible = !document.hidden
        }
        document.addEventListener('visibilitychange', onVisibility)
        if (!reduced) raf = requestAnimationFrame(tick)

        return () => {
            cancelAnimationFrame(raf)
            resizeObserver.disconnect()
            themeObserver.disconnect()
            intersection.disconnect()
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [])

    return <canvas ref={ref} aria-hidden="true" className={cn('pointer-events-none absolute inset-0 h-full w-full opacity-60', className)}/>
}

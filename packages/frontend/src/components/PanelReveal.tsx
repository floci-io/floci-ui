import {type ReactNode, useEffect, useState} from 'react'

const ms = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0

/**
 * transitions.dev "Accordion expand" for a region that mounts only while it is open (a create form, a detail
 * section): the height eases through grid rows 0fr to 1fr with a soft cross-blur, and the content stays mounted
 * while it closes.
 */
export function Reveal({open, children}: {open: boolean; children: ReactNode}) {
    const [mounted, setMounted] = useState(open)
    const [shown, setShown] = useState(open)

    useEffect(() => {
        if (open) {
            setMounted(true)
            let second = 0
            const first = requestAnimationFrame(() => {
                second = requestAnimationFrame(() => setShown(true))
            })
            return () => {
                cancelAnimationFrame(first)
                cancelAnimationFrame(second)
            }
        }
        setShown(false)
        const closeMs = ms('--acc-collapse')
        if (!closeMs) {
            setMounted(false)
            return
        }
        const timer = setTimeout(() => setMounted(false), closeMs)
        return () => clearTimeout(timer)
    }, [open])

    if (!mounted) return null
    return (
        <div className="t-acc" data-open={shown}>
            <div className="t-acc-panel">
                <div className="t-acc-panel-inner">{children}</div>
            </div>
        </div>
    )
}

/**
 * transitions.dev "Panel reveal" for a surface that appears beside the page (the resource inspector): it rises a
 * short way into place with a cross-blur. It mounts hidden and opens on the next frames.
 */
export function PanelEnter({children, className}: {children: ReactNode; className?: string}) {
    const [open, setOpen] = useState(false)

    useEffect(() => {
        let second = 0
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => setOpen(true))
        })
        return () => {
            cancelAnimationFrame(first)
            cancelAnimationFrame(second)
        }
    }, [])

    return (
        <div className={`t-panel-slide ${className ?? ''}`} data-open={open}>
            {children}
        </div>
    )
}

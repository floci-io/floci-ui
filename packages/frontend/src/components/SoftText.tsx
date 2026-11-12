import {useLayoutEffect, useRef} from 'react'
import {cn} from '@/lib/sodium/utils'

const ms = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0

type SoftElement = HTMLSpanElement & {_softTimer?: ReturnType<typeof setTimeout>}

/** transitions.dev "Text swap soft": the old text and the new one cross-blur in place, and the width eases. */
function softSwap(el: SoftElement, next: string): void {
    const prev = el.dataset.text ?? el.textContent ?? ''
    if (prev === next) return
    el.dataset.text = next
    clearTimeout(el._softTimer)

    const out = document.createElement('span')
    out.className = 't-text-soft-old'
    out.setAttribute('aria-hidden', 'true')
    out.textContent = prev
    const inn = document.createElement('span')
    inn.className = 't-text-soft-new'
    inn.textContent = next

    const w0 = el.getBoundingClientRect().width
    el.classList.remove('is-swapping')
    el.replaceChildren(out, inn)
    const w1 = inn.getBoundingClientRect().width
    el.style.width = `${w0}px`
    void el.offsetWidth // force a reflow so every transition runs
    el.classList.add('is-swapping')
    el.style.width = `${w1}px`

    el._softTimer = setTimeout(() => {
        el.classList.remove('is-swapping')
        el.style.removeProperty('width')
        el.textContent = next
    }, Math.max(ms('--text-soft-dur'), ms('--text-soft-resize-dur')) + 40)
}

interface SoftTextProps {
    value: string
    className?: string
}

/** A value that changes in place: only the text that changed blurs, nothing slides. */
export function SoftText({value, className}: SoftTextProps) {
    const ref = useRef<SoftElement>(null)
    const mounted = useRef(false)

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        if (!mounted.current) {
            mounted.current = true
            el.dataset.text = value
            el.textContent = value
            return
        }
        softSwap(el, value)
    }, [value])

    useLayoutEffect(() => () => clearTimeout(ref.current?._softTimer), [])

    return <span ref={ref} className={cn('t-text-soft', className)}/>
}

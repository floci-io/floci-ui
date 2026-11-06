import {useEffect, useState} from 'react'
import {Input} from '@/components/sodium/ui/input'

interface DateTimeInputProps {
    /** `YYYY-MM-DDTHH:mm`, the shape a `datetime-local` field holds, or "" while empty. */
    value: string
    onValueChange: (value: string) => void
    id?: string
    disabled?: boolean
    className?: string
    'aria-label'?: string
}

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/

/** `YYYY-MM-DDTHH:mm` for a valid local date and time as typed, null otherwise. */
function normalize(text: string): string | null {
    const match = SHAPE.exec(text.trim())
    if (!match) return null
    const [, year, month, day, hour, minute] = match.map(Number)
    const date = new Date(year, month - 1, day, hour, minute)
    const real = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        && date.getHours() === hour && date.getMinutes() === minute
    return real ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}` : null
}

const display = (value: string) => value.replace('T', ' ')

/**
 * A date and time typed as `YYYY-MM-DD HH:mm`, in Sodium's field, instead of the platform picker. It reports the
 * `datetime-local` shape once the text is a real moment, and "" when it is cleared.
 */
export function DateTimeInput({value, onValueChange, id, disabled, className, 'aria-label': ariaLabel}: DateTimeInputProps) {
    const [text, setText] = useState(display(value))

    useEffect(() => {
        setText((current) => (normalize(current) === value || (value === '' && current.trim() === '') ? current : display(value)))
    }, [value])

    const invalid = text.trim() !== '' && normalize(text) === null

    return (
        <Input
            mono
            id={id}
            className={className}
            aria-label={ariaLabel}
            aria-invalid={invalid ? true : undefined}
            placeholder="YYYY-MM-DD HH:mm"
            autoComplete="off"
            disabled={disabled}
            value={text}
            onChange={(event) => {
                const next = event.target.value
                setText(next)
                if (next.trim() === '') onValueChange('')
                else {
                    const normalized = normalize(next)
                    if (normalized !== null) onValueChange(normalized)
                }
            }}
        />
    )
}

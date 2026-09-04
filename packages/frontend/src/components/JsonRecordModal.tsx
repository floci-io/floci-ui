import {FormEvent, useEffect, useState} from 'react'
import {X} from 'lucide-react'

interface JsonRecordModalProps {
    open: boolean
    title: string
    description: string
    initialValue: string
    isPending: boolean
    submitError?: string
    onClose: () => void
    onSubmit: (document: Record<string, unknown>) => void
}

export function JsonRecordModal({
    open,
    title,
    description,
    initialValue,
    isPending,
    submitError,
    onClose,
    onSubmit,
}: JsonRecordModalProps) {
    const [value, setValue] = useState(initialValue)
    const [validationError, setValidationError] = useState<string>()

    useEffect(() => {
        if (!open) return
        setValue(initialValue)
        setValidationError(undefined)
    }, [initialValue, open])

    useEffect(() => {
        if (!open) return
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isPending) onClose()
        }
        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [isPending, onClose, open])

    if (!open) return null

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        try {
            const parsed = JSON.parse(value) as unknown
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setValidationError('Record must be a JSON object.')
                return
            }
            setValidationError(undefined)
            onSubmit(parsed as Record<string, unknown>)
        } catch (error) {
            setValidationError(error instanceof Error ? error.message : 'Invalid JSON.')
        }
    }

    return (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && !isPending && onClose()}>
            <form className="record-modal" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit}>
                <div className="record-modal-header">
                    <div>
                        <h3>{title}</h3>
                        <p>{description}</p>
                    </div>
                    <button className="icon-btn" type="button" aria-label="Close" disabled={isPending} onClick={onClose}>
                        <X size={15}/>
                    </button>
                </div>
                <textarea
                    className={`textarea code-textarea record-modal-editor ${validationError ? 'invalid' : ''}`}
                    aria-label="Record JSON"
                    value={value}
                    onChange={(event) => {
                        setValue(event.target.value)
                        setValidationError(undefined)
                    }}
                    spellCheck={false}
                    autoFocus
                    disabled={isPending}
                />
                {(validationError || submitError) && <div className="form-error">{validationError ?? submitError}</div>}
                <div className="modal-footer">
                    <button className="button" type="button" disabled={isPending} onClick={onClose}>Cancel</button>
                    <button className="button primary" type="submit" disabled={isPending}>
                        {isPending ? 'Adding' : 'Add record'}
                    </button>
                </div>
            </form>
        </div>
    )
}

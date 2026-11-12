import {FormEvent, useEffect, useState} from 'react'
import {Icon, XSquared as X} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Textarea} from '@/components/sodium/ui/textarea'
import {ModalOverlay} from './ModalOverlay'
import {Hint} from '@/components/Hint'

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
        <ModalOverlay onClose={() => !isPending && onClose()}>
            <form className="record-modal" onSubmit={submit}>
                <div className="record-modal-header">
                    <div>
                        <h2>{title}</h2>
                        <p>{description}</p>
                    </div>
                    <Hint label="Close"><Button variant="ghost" size="icon-sm" type="button" aria-label="Close" disabled={isPending} onClick={onClose}>
                        <Icon icon={X} />
                    </Button></Hint>
                </div>
                <Textarea
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
                    <Button variant="secondary" type="button" disabled={isPending} onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={isPending}>
                        {isPending ? 'Adding' : 'Add record'}
                    </Button>
                </div>
            </form>
        </ModalOverlay>
    )
}

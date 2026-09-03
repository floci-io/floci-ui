import {FormEvent, useEffect, useState} from 'react'
import {Plus} from 'lucide-react'
import type {FieldSchema, ServiceSchema} from '@/types/schema'

interface DynamicFormRendererProps {
    schema: ServiceSchema
    isSubmitting: boolean
    submitLabel?: string
    pendingLabel?: string
    submitError?: string | null
    onSubmit: (values: Record<string, unknown>) => void
}

export function DynamicFormRenderer({schema, isSubmitting, submitLabel = 'Create', pendingLabel = 'Creating', submitError, onSubmit}: DynamicFormRendererProps) {
    const [values, setValues] = useState<Record<string, string>>({})
    const [errors, setErrors] = useState<Record<string, string>>({})

    useEffect(() => {
        setValues(defaultValues(schema.fields))
        setErrors({})
    }, [schema])

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const nextErrors = validateValues(schema.fields, values)
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length > 0) return
        onSubmit(values)
    }

    return (
        <form className="dynamic-form" onSubmit={submit} noValidate>
            {schema.fields.map((field) => (
                <FieldRow
                    key={field.name}
                    field={field}
                    required={isFieldRequired(field, values)}
                    maxLength={fieldMaxLength(field, values).value}
                    value={values[field.name] ?? ''}
                    error={errors[field.name]}
                    onChange={(value) => {
                        setValues((prev) => ({...prev, [field.name]: value}))
                        setErrors((prev) => {
                            const next = {...prev}
                            delete next[field.name]
                            return next
                        })
                    }}
                />
            ))}
            <button className="button primary" type="submit" disabled={isSubmitting}>
                <Plus size={14}/>
                {isSubmitting ? pendingLabel : submitLabel}
            </button>
            {submitError && <div className="form-error" role="alert">{submitError}</div>}
        </form>
    )
}

function FieldRow({field, required, maxLength, value, error, onChange}: {field: FieldSchema; required: boolean; maxLength?: number; value: string; error?: string; onChange: (value: string) => void}) {
    return (
        <>
            {field.group && <div className="dynamic-form-group">{field.group}</div>}
            <label className={`dynamic-field${field.span ? ' dynamic-field--span' : ''}`}>
                <span>
                    {field.label}
                    {required && <em className="field-required">*</em>}
                </span>
                <FieldInput field={field} required={required} maxLength={maxLength} value={value} invalid={Boolean(error)} messageId={`${field.name}-message`} onChange={onChange}/>
                {(error || field.description) && (
                    <small id={`${field.name}-message`} className={error ? 'field-error' : undefined}>
                        {error ?? field.description}
                    </small>
                )}
            </label>
        </>
    )
}

function FieldInput({field, required, maxLength, value, invalid, messageId, onChange}: {field: FieldSchema; required: boolean; maxLength?: number; value: string; invalid: boolean; messageId: string; onChange: (value: string) => void}) {
    if (field.type === 'select') {
        return (
            <select className={`input ${invalid ? 'invalid' : ''}`} value={value} required={required} aria-invalid={invalid || undefined} aria-describedby={invalid || field.description ? messageId : undefined} onChange={(event) => onChange(event.target.value)}>
                <option value="">Default</option>
                {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        )
    }

    if (field.type === 'textarea') {
        return (
            <textarea
                className={`textarea code-textarea ${invalid ? 'invalid' : ''}`}
                value={value}
                required={required}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid || field.description ? messageId : undefined}
                minLength={field.validation?.minLength}
                maxLength={maxLength}
                rows={10}
                spellCheck={false}
                onChange={(event) => onChange(event.target.value)}
                placeholder={field.label}
            />
        )
    }

    return (
        <input
            type={field.type === 'password' ? 'password' : 'text'}
            className={`input ${invalid ? 'invalid' : ''}`}
            value={value}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid || field.description ? messageId : undefined}
            minLength={field.validation?.minLength}
            maxLength={maxLength}
            pattern={field.validation?.pattern}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.label}
        />
    )
}

function defaultValues(fields: FieldSchema[]): Record<string, string> {
    return Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? '']))
}

function validateValues(fields: FieldSchema[], values: Record<string, string>): Record<string, string> {
    const errors: Record<string, string> = {}

    for (const field of fields) {
        const value = (values[field.name] ?? '').trim()
        if (isFieldRequired(field, values) && !value) {
            errors[field.name] = `${field.label} is required.`
            continue
        }
        if (!value) continue
        if (field.validation?.minLength && value.length < field.validation.minLength) {
            errors[field.name] = field.validation.message ?? `${field.label} is too short.`
            continue
        }
        const maxLength = fieldMaxLength(field, values)
        if (maxLength.value && value.length > maxLength.value) {
            errors[field.name] = maxLength.message ?? `${field.label} is too long.`
            continue
        }
        if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(value)) {
            errors[field.name] = field.validation.message ?? `${field.label} is invalid.`
        }
    }

    return errors
}

function fieldMaxLength(field: FieldSchema, values: Record<string, string>): {value?: number; message?: string} {
    const conditional = field.validation?.maxLengthWhen
    if (conditional && values[conditional.field] === conditional.equals) {
        return {value: conditional.value, message: conditional.message}
    }
    return {value: field.validation?.maxLength, message: field.validation?.message}
}

function isFieldRequired(field: FieldSchema, values: Record<string, string>): boolean {
    if (field.required) return true
    if (!field.requiredWhen) return false
    return values[field.requiredWhen.field] === field.requiredWhen.equals
}

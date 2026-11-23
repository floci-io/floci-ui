import {FormEvent, useEffect, useState} from 'react'
import {Plus} from 'lucide-react'
import type {FieldCondition, FieldSchema, ServiceSchema} from '@/types/schema'

interface DynamicFormRendererProps {
    schema: ServiceSchema
    fields?: FieldSchema[]
    initialValues?: Record<string, unknown>
    isSubmitting: boolean
    submitLabel?: string
    pendingLabel?: string
    submitError?: string | null
    /**
     * Why the options of a field that names another resource could not be
     * loaded, and the way to ask again.
     *
     * <p>A field whose options come from the service holds none when the request
     * fails, and an empty choice and a failed request look the same to the
     * caller. The failure is said so beside the field, and the request can be
     * made again.
     */
    optionsError?: string
    onRetryOptions?: () => void
    onCancel?: () => void
    onSubmit: (values: Record<string, unknown>) => void
}

export function DynamicFormRenderer({
    schema,
    fields,
    initialValues,
    isSubmitting,
    submitLabel = 'Create',
    pendingLabel = 'Creating',
    submitError,
    optionsError,
    onRetryOptions,
    onCancel,
    onSubmit,
}: DynamicFormRendererProps) {
    const activeFields = fields ?? schema.fields
    const [values, setValues] = useState<Record<string, string>>(() =>
        getInitialFormValues(activeFields, initialValues),
    )
    const [errors, setErrors] = useState<Record<string, string>>({})
    const visibleFields = activeFields.filter((field) => isFieldVisible(field, values))
    // A required select with no default is painted with its first option, but
    // the form value stays empty, so the submit is refused for a field that
    // shows a choice. The value follows the option the browser paints, including
    // when the options arrive after the form opens.
    useEffect(() => {
        setValues((prev) => {
            let next = prev
            for (const field of visibleFields) {
                if (field.type !== 'select' || !isFieldRequired(field, prev)) continue
                if ((prev[field.name] ?? '') !== '') continue
                const first = field.options?.[0]
                if (!first || first.value === '') continue
                next = next === prev ? {...prev} : next
                next[field.name] = first.value
            }
            return next
        })
    }, [visibleFields])
    // A form that makes more than one kind of thing says so on its button: the
    // option that is picked names what it makes. Only a field on the form may
    // name it: a field hidden by another answer keeps its value, and a hidden
    // field must not decide what the button says.
    const buttonLabel =
        visibleFields
            .map((field) => field.options?.find((option) => option.value === values[field.name])?.submitLabel)
            .find((label): label is string => Boolean(label)) ?? submitLabel;

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const nextErrors = validateValues(visibleFields, values)
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length > 0) return
        onSubmit(values)
    }

    return (
        <form className="dynamic-form" onSubmit={submit} noValidate>
            {visibleFields.map((field, index) => (
                <FieldRow
                    key={field.name}
                    field={field}
                    showGroup={Boolean(field.group && field.group !== visibleFields[index - 1]?.group)}
                    required={isFieldRequired(field, values)}
                    maxLength={fieldMaxLength(field, values).value}
                    value={values[field.name] ?? ''}
                    error={errors[field.name]}
                    optionsError={field.optionsFrom ? optionsError : undefined}
                    onRetryOptions={onRetryOptions}
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
            <div style={{gridColumn: '1 / -1', justifySelf: 'end', display: 'flex', gap: '8px', alignItems: 'center', marginTop: 4}}>
                {onCancel && (
                    <button className="button" type="button" disabled={isSubmitting} onClick={onCancel}>
                        Cancel
                    </button>
                )}
                <button className="button primary" type="submit" disabled={isSubmitting}>
                    {buttonLabel === 'Create' && <Plus size={14}/>}
                    {isSubmitting ? pendingLabel : buttonLabel}
                </button>
            </div>
            {submitError && <div className="form-error" role="alert">{submitError}</div>}
        </form>
    )
}

function FieldRow({field, showGroup, required, maxLength, value, error, optionsError, onRetryOptions, onChange}: {field: FieldSchema; showGroup: boolean; required: boolean; maxLength?: number; value: string; error?: string; optionsError?: string; onRetryOptions?: () => void; onChange: (value: string) => void}) {
    return (
        <>
            {showGroup && <div className="dynamic-form-group">{field.group}</div>}
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
                {optionsError && (
                    <small className="field-error" role="alert">
                        {optionsError}{' '}
                        {onRetryOptions && (
                            <button className="link-button" type="button" onClick={onRetryOptions}>Retry</button>
                        )}
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
                {/* A required field has no default, so offering one would only let
                    the caller choose it and be told the field is required. */}
                {!required && <option value="">Default</option>}
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

function getInitialFormValues(
    fields: FieldSchema[],
    initialValues?: Record<string, unknown>,
): Record<string, string> {
    const defaults = defaultValues(fields)
    if (initialValues) {
        for (const [key, val] of Object.entries(initialValues)) {
            if (val !== undefined && val !== null) {
                defaults[key] = String(val)
            }
        }
    }
    return defaults
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
    return conditionHolds(field.requiredWhen, values)
}

function isFieldVisible(field: FieldSchema, values: Record<string, string>): boolean {
    if (!field.visibleWhen) return true
    return conditionHolds(field.visibleWhen, values)
}

function conditionHolds(condition: FieldCondition, values: Record<string, string>): boolean {
    const actual = values[condition.field]
    return condition.notEquals !== undefined ? actual !== condition.notEquals : actual === condition.equals
}

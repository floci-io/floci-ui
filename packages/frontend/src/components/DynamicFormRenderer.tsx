import {FormEvent, useState} from 'react'
import {Icon, PlusSquared as Plus} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import {Textarea} from '@/components/sodium/ui/textarea'
import type {FieldSchema, ServiceSchema} from '@/types/schema'

interface DynamicFormRendererProps {
    schema: ServiceSchema
    fields?: FieldSchema[]
    initialValues?: Record<string, unknown>
    isSubmitting: boolean
    submitLabel?: string
    pendingLabel?: string
    submitError?: string | null
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
    onCancel,
    onSubmit,
}: DynamicFormRendererProps) {
    const activeFields = fields ?? schema.fields
    const [values, setValues] = useState<Record<string, string>>(() =>
        getInitialFormValues(activeFields, initialValues),
    )
    const [errors, setErrors] = useState<Record<string, string>>({})
    const visibleFields = activeFields.filter((field) => isFieldVisible(field, values))

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
            <div className="flex gap-2 items-center mt-1 col-span-full justify-self-end">
                {onCancel && (
                    <Button variant="secondary" type="button" disabled={isSubmitting} onClick={onCancel}>
                        Cancel
                    </Button>
                )}
                <Button type="submit" disabled={isSubmitting}>
                    {submitLabel === 'Create' && <Icon icon={Plus} size={14}/>}
                    {isSubmitting ? pendingLabel : submitLabel}
                </Button>
            </div>
            {submitError && <div className="form-error" role="alert">{submitError}</div>}
        </form>
    )
}

function FieldRow({field, showGroup, required, maxLength, value, error, onChange}: {field: FieldSchema; showGroup: boolean; required: boolean; maxLength?: number; value: string; error?: string; onChange: (value: string) => void}) {
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
            </label>
        </>
    )
}

function FieldInput({field, required, maxLength, value, invalid, messageId, onChange}: {field: FieldSchema; required: boolean; maxLength?: number; value: string; invalid: boolean; messageId: string; onChange: (value: string) => void}) {
    if (field.type === 'select') {
        return (
            <OptionSelect aria-label={field.label} value={value} required={required} aria-invalid={invalid || undefined} aria-describedby={invalid || field.description ? messageId : undefined} onValueChange={(value) => onChange(value)}>
                <option value="">Default</option>
                {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </OptionSelect>
        )
    }

    if (field.type === 'textarea') {
        return (
            <Textarea
                aria-label={field.label}
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
        <Input
            aria-label={field.label}
            type={field.type === 'password' ? 'password' : 'text'}
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
    return values[field.requiredWhen.field] === field.requiredWhen.equals
}

function isFieldVisible(field: FieldSchema, values: Record<string, string>): boolean {
    if (!field.visibleWhen) return true
    return values[field.visibleWhen.field] === field.visibleWhen.equals
}

import {Children, Fragment, isValidElement, type ReactElement, type ReactNode} from 'react'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
    type SelectSize,
} from '@/components/sodium/ui/select'

const EMPTY = '__empty__'

interface OptionDef {
    value: string
    label: ReactNode
    disabled?: boolean
}

type Entry = {kind: 'option'; option: OptionDef} | {kind: 'group'; label: ReactNode; options: OptionDef[]}

interface OptionProps {
    value?: string | number
    disabled?: boolean
    children?: ReactNode
}

interface OptGroupProps {
    label?: ReactNode
    children?: ReactNode
}

function textOf(node: ReactNode): string {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (isValidElement<{children?: ReactNode}>(node)) return textOf(node.props.children)
    return ''
}

function collect(children: ReactNode, entries: Entry[]): void {
    Children.forEach(children, (child) => {
        if (!isValidElement(child)) return
        if (child.type === Fragment) {
            collect((child as ReactElement<{children?: ReactNode}>).props.children, entries)
        } else if (child.type === 'option') {
            const props = (child as ReactElement<OptionProps>).props
            entries.push({
                kind: 'option',
                option: {value: String(props.value ?? textOf(props.children)), label: props.children, disabled: props.disabled},
            })
        } else if (child.type === 'optgroup') {
            const props = (child as ReactElement<OptGroupProps>).props
            const inner: Entry[] = []
            collect(props.children, inner)
            entries.push({
                kind: 'group',
                label: props.label,
                options: inner.flatMap((entry) => (entry.kind === 'option' ? [entry.option] : entry.options)),
            })
        }
    })
}

interface OptionSelectProps {
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
    required?: boolean
    name?: string
    id?: string
    size?: SelectSize
    className?: string
    'aria-label'?: string
    'aria-labelledby'?: string
    'aria-describedby'?: string
    'aria-invalid'?: boolean
    /** `<option>` and `<optgroup>` elements, as for a native select. An option with the value "" is a row like any other. */
    children?: ReactNode
}

/**
 * A select that keeps the native `<select>` authoring shape (`<option>` children, a string value) and draws Sodium's
 * own list: a field-styled trigger and a themed popup instead of the platform picker. The `""` option is not a row,
 * it stays a selectable row, so a field can go back to its default.
 */
export function OptionSelect({
    value,
    onValueChange,
    disabled,
    required,
    name,
    id,
    size,
    className,
    children,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
}: OptionSelectProps) {
    const entries: Entry[] = []
    collect(children, entries)
    const flat = entries.flatMap((entry) => (entry.kind === 'option' ? [entry.option] : entry.options))
    const hasEmpty = flat.some((option) => option.value === '')
    const known = value !== undefined && value !== '' && !flat.some((option) => option.value === value)
    const items = [...flat, ...(known ? [{value: value as string, label: value as string}] : [])]
    const toKey = (optionValue: string) => (optionValue === '' ? EMPTY : optionValue)
    const selected = value === undefined ? undefined : value === '' ? (hasEmpty ? EMPTY : null) : value

    const renderItem = (option: OptionDef) => (
        <SelectItem key={toKey(option.value)} value={toKey(option.value)} disabled={option.disabled} data-value={option.value}>
            {option.label}
        </SelectItem>
    )

    return (
        <Select
            items={items.map(({value: itemValue, label}) => ({value: toKey(itemValue), label}))}
            value={selected}
            onValueChange={(next) => onValueChange?.(next === null || next === EMPTY ? '' : next)}
            disabled={disabled}
            required={required}
            name={name}
        >
            <SelectTrigger
                id={id}
                size={size}
                data-value={value ?? ''}
                className={className}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
            >
                <SelectValue/>
            </SelectTrigger>
            <SelectContent size={size === 'sm' ? 'sm' : 'default'}>
                {entries.map((entry, index) => {
                    if (entry.kind === 'option') return renderItem(entry.option)
                    return (
                        <SelectGroup key={`group-${index}`}>
                            <SelectLabel>{entry.label}</SelectLabel>
                            {entry.options.map(renderItem)}
                        </SelectGroup>
                    )
                })}
                {known && renderItem({value: value as string, label: value as string})}
            </SelectContent>
        </Select>
    )
}

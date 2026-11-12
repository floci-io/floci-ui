'use client';

import {createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode} from 'react';
import {Field as FieldPrimitive} from '@base-ui/react/field';
import {Fieldset as FieldsetPrimitive} from '@base-ui/react/fieldset';
import {Form as FormPrimitive} from '@base-ui/react/form';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn, mergeClass} from '@/lib/sodium/utils';

// Sodium's field: the label, description and error every input shares, on Base UI's Field, Fieldset and Form.
// Field, FieldLabel, FieldDescription and FieldError make one question; FieldSet and FieldLegend group several;
// FieldGroup spaces them; Form validates them together. Label is the plain label for a control outside a Field.
//
// Base UI binds the label's htmlFor, the description and error ids and the invalid state to any Base UI control
// inside (Input, Textarea, Checkbox, Switch, Slider), so a control never needs an id of its own.
//
// The label is a mono label in capitals (type-label-sm, 12px) in text-2, 6px above the control, so the value the
// person types in text-1 leads and the label reads as the name of a place. The description and the error are
// sentences, so they are the sans caption (13px) under it: the description in text-2, the error in the failure word.
// The invalid control turns its own edge red; the field adds no wash and no icon, because the edge and the sentence
// already say it.
//
// Errors wait for the person: a field validates when focus leaves it, never on the first keystroke. Once invalid it
// checks again on every change, so the error clears the moment the value is fixed, then goes back to waiting for blur.
//
// required and optional mark a field in words after the label, never with a red asterisk: red means something went
// wrong, and nothing has yet. Mark whichever kind is rarer in the form.

// Whether a part sits inside a Field. Base UI's description and error throw outside a Field.Root, so outside one
// (under a FieldSet's legend, beside a bare checkbox) these parts fall back to plain elements.
const InField = createContext(false);

// Whether the Field or a FieldSet around it is disabled, so a control's own buttons go quiet with its text.
const FieldDisabled = createContext(false);

/** True inside a disabled Field or FieldSet. Combine it with the control's own disabled prop. */
function useFieldDisabled() {
  return useContext(FieldDisabled);
}

const labelClasses = [
  'inline-flex w-fit max-w-full min-w-0 items-center gap-2 type-label-sm text-text-2 select-none [overflow-wrap:anywhere]',
  '[&_svg]:size-(--icon) [&_svg]:shrink-0 [&_svg]:text-text-3',
  'group-data-disabled/field:cursor-not-allowed group-data-disabled/field:text-text-disabled',
].join(' ');

/** The quiet word after a label: Optional, Required, a unit or a limit. */
function LabelHint({className, ...props}: ComponentProps<'span'>) {
  return <span data-slot="label-hint" className={cn('type-label-sm whitespace-nowrap text-text-3 group-data-disabled/field:text-text-disabled', className)} {...props}/>;
}

type Mark = {
  /** Adds a quiet "Optional" after the label. Mark the optional fields when most are required. */
  optional?: boolean;
  /** Adds a quiet "Required" after the label. Mark the required fields when most are optional. */
  required?: boolean;
};

function marks({optional, required}: Mark) {
  if (optional) return <LabelHint>Optional</LabelHint>;
  if (required) return <LabelHint>Required</LabelHint>;
  return null;
}

type LabelProps = ComponentProps<'label'> & Mark;

/**
 * A plain label for a control outside a Field: pass htmlFor or wrap the control, or it names nothing. Inside a Field,
 * use FieldLabel, which Base UI binds for you.
 */
function Label({className, optional, required, children, ...props}: LabelProps) {
  return <label data-slot="label" className={cn(labelClasses, 'peer-disabled:text-text-disabled', className)} {...props}>
    {children}
    {marks({optional, required})}
  </label>;
}

/** Fieldsets and fields, 16px apart in a group and 24px between groups. The container a responsive field queries. */
function FieldGroup({className, ...props}: ComponentProps<'div'>) {
  return <div
    data-slot="field-group"
    className={cn('group/field-group @container/field-group flex w-full min-w-0 flex-col gap-4 has-[>[data-slot=field-set]]:gap-6', className)}
    {...props}
  />;
}

/** A titled set of related fields: a fieldset with a legend. Disabling it disables every field inside. */
function FieldSet({className, disabled, children, ...props}: FieldsetPrimitive.Root.Props) {
  return <FieldDisabled.Provider value={!!disabled}>
    <FieldsetPrimitive.Root
      data-slot="field-set"
      disabled={disabled}
      className={mergeClass('flex min-w-0 flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3', className)}
      {...props}
    >{children}</FieldsetPrimitive.Root>
  </FieldDisabled.Provider>;
}

/** The fieldset's title: a section heading by default, or a label-sized one for a short set inside a form. */
function FieldLegend({className, variant = 'legend', ...props}: FieldsetPrimitive.Legend.Props & {variant?: 'legend' | 'label'}) {
  return <FieldsetPrimitive.Legend
    data-slot="field-legend"
    data-variant={variant}
    className={mergeClass('text-text-1 data-[variant=label]:type-label-sm data-[variant=label]:text-text-2 data-[variant=legend]:type-heading-sm data-disabled:text-text-disabled', className)}
    {...props}
  />;
}

const fieldVariants = cva('group/field flex w-full min-w-0', {
  variants: {
    orientation: {
      // Label, control, then description and error, 6px apart.
      vertical: 'flex-col gap-1.5',
      // The control beside its label. A checkbox, a radio or a switch sits at the end with the label filling the row; a
      // text control takes the rest of the row after a --label-col label column, so stacked fields line up.
      horizontal: [
        'flex-row items-center gap-3 has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto *:data-[slot=field-label]:shrink-0',
        'has-[>[data-slot=input]]:gap-4 has-[>[data-slot=input]]:*:data-[slot=field-label]:w-(--label-col) has-[>[data-slot=input]]:*:data-[slot=field-label]:flex-none has-[>[data-slot=input]]:*:data-[slot=input]:flex-1',
        'has-[>[data-slot=textarea]]:items-start has-[>[data-slot=textarea]]:gap-4 has-[>[data-slot=textarea]]:*:data-[slot=field-label]:w-(--label-col) has-[>[data-slot=textarea]]:*:data-[slot=field-label]:flex-none has-[>[data-slot=textarea]]:*:data-[slot=field-label]:pt-2.5',
      ].join(' '),
      // Vertical in a narrow container, the label beside the control once the field group is 448px wide.
      responsive: [
        'flex-col gap-1.5',
        '@md/field-group:flex-row @md/field-group:items-center @md/field-group:gap-6',
        '@md/field-group:*:data-[slot=field-label]:w-(--label-col) @md/field-group:*:data-[slot=field-label]:shrink-0 @md/field-group:*:data-[slot=field-content]:flex-auto',
      ].join(' '),
    },
  },
  defaultVariants: {orientation: 'vertical'},
});

type FieldProps = FieldPrimitive.Root.Props & VariantProps<typeof fieldVariants>;

/** Reports the root's validity up to Field, which picks the next validation mode from it. */
function FieldRoot({rootProps, invalid, disabled, onValidity}: {rootProps: ComponentProps<'div'>; invalid: boolean; disabled: boolean; onValidity: (invalid: boolean) => void}) {
  useEffect(() => { onValidity(invalid); }, [invalid, onValidity]);
  return <FieldDisabled.Provider value={disabled}><div {...rootProps} data-status={invalid ? 'fail' : undefined}/></FieldDisabled.Provider>;
}

/**
 * One label, one control, an optional description and an error. Validation follows Base UI (`invalid` for state you
 * hold, `validate` for your own check, or the control's native constraints), timed by Sodium: checked on blur, then on
 * every change while it is invalid. Pass validationMode to override.
 */
function Field({className, orientation = 'vertical', validationMode, ...props}: FieldProps) {
  const [invalid, setInvalid] = useState(false);
  const nested = useContext(InField);
  const inSet = useFieldDisabled();
  useEffect(() => {
    if (nested && process.env.NODE_ENV !== 'production') console.warn('Sodium Field: a Field inside a Field binds its control to the outer label. Use FieldSet to group fields.');
  }, [nested]);
  return <InField.Provider value>
    <FieldPrimitive.Root
      data-slot="field"
      data-orientation={orientation}
      validationMode={validationMode ?? (invalid ? 'onChange' : 'onBlur')}
      className={mergeClass(fieldVariants({orientation}), className)}
      render={(rootProps, state) => <FieldRoot rootProps={rootProps as ComponentProps<'div'>} invalid={state.valid === false} disabled={!!state.disabled || inSet} onValidity={setInvalid}/>}
      {...props}
    />
  </InField.Provider>;
}

/** Stacks a label and its description beside the control in a horizontal field. */
function FieldContent({className, ...props}: ComponentProps<'div'>) {
  return <div data-slot="field-content" className={cn('flex min-w-0 flex-1 flex-col gap-0.5', className)} {...props}/>;
}

type FieldLabelProps = FieldPrimitive.Label.Props & Mark;

/** The field's label, bound to its control by Base UI. */
function FieldLabel({className, optional, required, children, ...props}: FieldLabelProps) {
  return <FieldPrimitive.Label data-slot="field-label" className={mergeClass([labelClasses, 'data-disabled:text-text-disabled'], className)} {...props}>
    {children}
    {marks({optional, required})}
  </FieldPrimitive.Label>;
}

/** A label-styled title that is not a <label>, for a field whose control names itself (a radio group, a slider). */
function FieldTitle({className, optional, required, children, ...props}: ComponentProps<'div'> & Mark) {
  return <div data-slot="field-title" className={cn(labelClasses, className)} {...props}>
    {children}
    {marks({optional, required})}
  </div>;
}

const descriptionClasses = 'max-w-(--measure-hint) type-caption text-text-2 [overflow-wrap:anywhere] group-data-disabled/field:text-text-disabled [&_a]:underline [&_a]:underline-offset-2';

/** Helper text under the control, read out with it. Say what the value is for or what shape it takes. */
function FieldDescription({className, ...props}: FieldPrimitive.Description.Props) {
  const inField = useContext(InField);
  if (!inField) {
    const {render: _render, ...rest} = props;
    // Outside a Field there is no Base UI state to hand a className function, so only a string applies.
    return <p data-slot="field-description" className={cn(descriptionClasses, typeof className === 'string' && className)} {...(rest as ComponentProps<'p'>)}/>;
  }
  return <FieldPrimitive.Description data-slot="field-description" className={mergeClass(descriptionClasses, className)} {...props}/>;
}

/** A rule between groups of fields, with optional words in the middle ("or"). */
function FieldSeparator({children, className, ...props}: ComponentProps<'div'> & {children?: ReactNode}) {
  return <div data-slot="field-separator" role="separator" className={cn('flex items-center gap-3 type-micro text-text-3', className)} {...props}>
    <span aria-hidden className="h-px flex-1 bg-line"/>
    {children && <><span>{children}</span><span aria-hidden className="h-px flex-1 bg-line"/></>}
  </div>;
}

type FieldErrorProps = FieldPrimitive.Error.Props & {
  /** Errors from your own validation or a schema. Duplicates drop; two or more become a list. */
  errors?: Array<{message?: string} | undefined>;
};

const errorClasses = 'flex min-w-0 max-w-(--measure-hint) flex-col gap-0.5 type-caption text-fail-text [overflow-wrap:anywhere]';

/**
 * The error under the control, in the failure word. With errors or children it always shows; with neither, Base UI
 * shows the control's own validation message once the field is invalid.
 */
function FieldError({className, children, errors, match, ...props}: FieldErrorProps) {
  const unique = errors ? [...new Map(errors.filter(e => e?.message).map(e => [e!.message, e!])).values()] : [];
  const content = children ?? (unique.length === 1 ? unique[0].message : unique.length > 1
    ? <ul className="flex flex-col gap-0.5">{unique.map(e => <li key={e.message}>{e.message}</li>)}</ul>
    : undefined);
  const always = content !== undefined;
  const inField = useContext(InField);
  if (errors && !unique.length && children === undefined) return null;
  if (!inField) {
    if (!always) return null;
    const {render: _render, ...rest} = props;
    return <div data-slot="field-error" data-status="fail" role="alert" className={cn(errorClasses, typeof className === 'string' && className)} {...(rest as ComponentProps<'div'>)}>{content}</div>;
  }
  return <FieldPrimitive.Error
    data-slot="field-error"
    data-status="fail"
    match={match ?? (always ? true : undefined)}
    className={mergeClass(errorClasses, className)}
    {...props}
    {...(always ? {children: content} : {})}
  />;
}

type FormProps = FormPrimitive.Props & {
  /**
   * Waiting on the submit. Sets aria-busy and drops further submits, Enter in a field included, so a request never
   * goes out twice. Pass the same flag to the submit Button's pending.
   */
  pending?: boolean;
};

/** A form that collects Field values, validates them on submit, focuses the first invalid field and routes server errors back to fields by name through errors. */
function Form({className, pending, onSubmit, onFormSubmit, ...props}: FormProps) {
  return <FormPrimitive
    data-slot="form"
    aria-busy={pending || undefined}
    onSubmit={e => {
      if (pending) { e.preventDefault(); return; }
      onSubmit?.(e);
    }}
    onFormSubmit={onFormSubmit && ((values, details) => { if (!pending) onFormSubmit(values, details); })}
    className={mergeClass('flex w-full min-w-0 flex-col gap-4', className)}
    {...props}
  />;
}

/** The row of buttons at the end of a form: secondaries first, the one slab last, under the reading hand. */
function FormActions({className, ...props}: ComponentProps<'div'>) {
  return <div data-slot="form-actions" className={cn('flex flex-wrap items-center gap-2', className)} {...props}/>;
}

/** Where a submit's result is announced. Render it from the start, empty, so a screen reader hears it change. */
function FormStatus({className, status, ...props}: ComponentProps<'p'> & {status?: 'ok' | 'fail'}) {
  return <p
    data-slot="form-status"
    role="status"
    data-status={status}
    className={cn('min-h-lh type-caption text-text-1 data-[status=fail]:text-fail-text data-[status=ok]:text-ok-text', className)}
    {...props}
  />;
}

export {
  Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle,
  Form, FormActions, FormStatus, Label, LabelHint, labelClasses, useFieldDisabled,
  type FieldProps, type FieldErrorProps, type FormProps, type LabelProps,
};

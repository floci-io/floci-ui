import {screen, within} from '@testing-library/react'
import type {UserEvent} from '@testing-library/user-event'

/**
 * Picks an option in a Sodium select, the way a person does: open the trigger, then press the row.
 * `option` is the row's visible label, or its value when the value is what the row shows.
 */
export async function chooseOption(user: UserEvent, trigger: HTMLElement, option: string | RegExp): Promise<void> {
    await user.click(trigger)
    const listbox = await screen.findByRole('listbox')
    const rows = within(listbox).getAllByRole('option')
    const wanted = typeof option === 'string' ? option.toLowerCase() : option
    const row = rows.find((candidate) => {
        const text = (candidate.textContent ?? '').trim()
        if (typeof wanted === 'string') {
            return text.toLowerCase() === wanted || candidate.getAttribute('data-value') === option
        }
        return wanted.test(text)
    })
    if (!row) {
        throw new Error(`No option "${String(option)}" in [${rows.map((candidate) => candidate.textContent).join(', ')}]`)
    }
    await user.click(row)
}

/** The label a Sodium select currently shows. */
export function selectedLabel(trigger: HTMLElement): string {
    return (trigger.textContent ?? '').trim()
}

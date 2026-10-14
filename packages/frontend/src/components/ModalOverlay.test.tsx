import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {useState} from 'react'
import {ModalOverlay} from './ModalOverlay'

function Harness({onClose, autoFocusField = false}: {onClose: () => void; autoFocusField?: boolean}) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open</button>
            {open && (
                <ModalOverlay onClose={() => { onClose(); setOpen(false) }}>
                    <div>
                        <h2>Create Route Table</h2>
                        <input aria-label="Name" autoFocus={autoFocusField}/>
                        <button type="button">Create</button>
                    </div>
                </ModalOverlay>
            )}
        </>
    )
}

describe('ModalOverlay', () => {
    it('is a dialog named by its heading and takes focus', async () => {
        render(<Harness onClose={() => {}}/>)
        await userEvent.click(screen.getByRole('button', {name: 'Open'}))

        const dialog = screen.getByRole('dialog', {name: 'Create Route Table'})
        expect(dialog).toHaveAttribute('aria-modal', 'true')
        expect(screen.getByRole('textbox', {name: 'Name'})).toHaveFocus()
    })

    it('keeps Tab inside the dialog', async () => {
        render(<Harness onClose={() => {}}/>)
        await userEvent.click(screen.getByRole('button', {name: 'Open'}))

        await userEvent.tab()
        expect(screen.getByRole('button', {name: 'Create'})).toHaveFocus()
        await userEvent.tab()
        expect(screen.getByRole('textbox', {name: 'Name'})).toHaveFocus()
        await userEvent.tab({shift: true})
        expect(screen.getByRole('button', {name: 'Create'})).toHaveFocus()
    })

    it('closes on Escape and returns focus to the opener', async () => {
        const onClose = vi.fn()
        render(<Harness onClose={onClose}/>)
        await userEvent.click(screen.getByRole('button', {name: 'Open'}))

        await userEvent.keyboard('{Escape}')
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(screen.getByRole('button', {name: 'Open'})).toHaveFocus()
    })

    it('returns focus to the opener when a field uses autoFocus', async () => {
        render(<Harness onClose={() => {}} autoFocusField/>)
        await userEvent.click(screen.getByRole('button', {name: 'Open'}))
        expect(screen.getByRole('textbox', {name: 'Name'})).toHaveFocus()

        await userEvent.keyboard('{Escape}')
        expect(screen.getByRole('button', {name: 'Open'})).toHaveFocus()
    })

    it('uses an explicit aria-label over a heading lookup', () => {
        render(
            <ModalOverlay onClose={() => {}} aria-label="Move photo.png">
                <div className="modal-header">Move</div>
            </ModalOverlay>,
        )
        const dialog = screen.getByRole('dialog', {name: 'Move photo.png'})
        expect(dialog).not.toHaveAttribute('aria-labelledby')
    })

    it('closes on a backdrop click but not on a click inside', async () => {
        const onClose = vi.fn()
        render(<Harness onClose={onClose}/>)
        await userEvent.click(screen.getByRole('button', {name: 'Open'}))

        await userEvent.click(screen.getByRole('heading', {name: 'Create Route Table'}))
        expect(onClose).not.toHaveBeenCalled()
        await userEvent.click(screen.getByRole('dialog'))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('lets only the topmost of two stacked dialogs answer Escape', async () => {
        const outer = vi.fn()
        const inner = vi.fn()
        render(
            <ModalOverlay onClose={outer}>
                <h2>Outer</h2>
                <ModalOverlay onClose={inner}>
                    <h2>Inner</h2>
                </ModalOverlay>
            </ModalOverlay>,
        )

        await userEvent.keyboard('{Escape}')
        expect(inner).toHaveBeenCalledTimes(1)
        expect(outer).not.toHaveBeenCalled()
    })
})

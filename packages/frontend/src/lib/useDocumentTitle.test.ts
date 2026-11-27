import {renderHook} from '@testing-library/react'
import {beforeEach, describe, expect, it} from 'vitest'
import {BASE_DOCUMENT_TITLE, useDocumentTitle} from '@/lib/useDocumentTitle'

describe('useDocumentTitle', () => {
    beforeEach(() => {
        document.title = BASE_DOCUMENT_TITLE
    })

    it('puts the most specific part first and the base title last', () => {
        renderHook(() => useDocumentTitle('S3', 'AWS'))
        expect(document.title).toBe('S3 · AWS · Floci UI')
    })

    it('skips parts that are not known yet', () => {
        renderHook(() => useDocumentTitle(undefined, 'Settings', ''))
        expect(document.title).toBe('Settings · Floci UI')
    })

    it('follows the parts as they change', () => {
        const {rerender} = renderHook(({name}) => useDocumentTitle(name, 'AWS'), {initialProps: {name: 'storage'}})
        expect(document.title).toBe('storage · AWS · Floci UI')
        rerender({name: 'S3'})
        expect(document.title).toBe('S3 · AWS · Floci UI')
    })

    it('restores the base title on unmount', () => {
        const {unmount} = renderHook(() => useDocumentTitle('Activity'))
        expect(document.title).toBe('Activity · Floci UI')
        unmount()
        expect(document.title).toBe(BASE_DOCUMENT_TITLE)
    })
})

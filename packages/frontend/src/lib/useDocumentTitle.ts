import {useEffect} from 'react'

export const BASE_DOCUMENT_TITLE = 'Floci UI'

/**
 * Names the page for tabs, history and screen readers (WCAG 2.4.2), most
 * specific part first: `useDocumentTitle('S3', 'AWS')` gives "S3 · AWS · Floci UI".
 * Empty parts are skipped, and the base title comes back on unmount.
 */
export function useDocumentTitle(...parts: Array<string | undefined>) {
    const title = [...parts.filter((part): part is string => Boolean(part)), BASE_DOCUMENT_TITLE].join(' · ')

    useEffect(() => {
        document.title = title
    }, [title])

    useEffect(() => () => {
        document.title = BASE_DOCUMENT_TITLE
    }, [])
}

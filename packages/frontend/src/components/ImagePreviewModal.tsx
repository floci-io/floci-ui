import {useEffect, useState} from 'react'
import {AlertTriangle, Download, Loader2, X} from 'lucide-react'
import type {ObjectPreviewKind} from '@/lib/format'

interface ObjectPreviewModalProps {
    kind: ObjectPreviewKind
    name: string
    src: string
    onClose: () => void
}

/** Text previews are fetched inline, so cap how much we pull and render. */
const TEXT_PREVIEW_LIMIT = 200_000

/**
 * Lightbox/preview drawer for storage objects. Reuses the existing object
 * download URL as the media source — no new backend endpoint, per the
 * "never invent a custom protocol" rule in CONTRIBUTING.md. Image/video/audio
 * are rendered via native HTML media elements; text is fetched and shown as
 * plain text, since there is no inline "view" mode on the download endpoint.
 */
export function ImagePreviewModal({kind, name, src, onClose}: ObjectPreviewModalProps) {
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [onClose])

    return (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
            <div className="image-preview-modal">
                <div className="image-preview-header">
                    <span className="image-preview-name" title={name}>{name}</span>
                    <div className="image-preview-actions">
                        <a className="icon-btn" href={src} title={`Download ${name}`}>
                            <Download size={14}/>
                        </a>
                        <button className="icon-btn" type="button" onClick={onClose} title="Close">
                            <X size={14}/>
                        </button>
                    </div>
                </div>
                <div className="image-preview-body">
                    {kind === 'image' && <ImagePreview src={src} name={name}/>}
                    {kind === 'video' && <video src={src} controls autoPlay={false}/>}
                    {kind === 'audio' && <audio src={src} controls autoPlay={false} style={{width: '100%'}}/>}
                    {kind === 'text' && <TextPreview src={src}/>}
                </div>
            </div>
        </div>
    )
}

function ImagePreview({src, name}: {src: string; name: string}) {
    const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
    return (
        <>
            {status === 'loading' && <PreviewStatus label="Loading preview…"/>}
            {status === 'error' && <PreviewStatus label="Could not load a preview for this object." isError/>}
            <img
                src={src}
                alt={name}
                style={{display: status === 'loaded' ? 'block' : 'none'}}
                onLoad={() => setStatus('loaded')}
                onError={() => setStatus('error')}
            />
        </>
    )
}

function TextPreview({src}: {src: string}) {
    const [state, setState] = useState<{status: 'loading' | 'loaded' | 'error'; text: string; truncated: boolean}>({
        status: 'loading', text: '', truncated: false,
    })

    useEffect(() => {
        const controller = new AbortController()
        setState({status: 'loading', text: '', truncated: false})
        readTextPreview(src, controller.signal)
            .then((result) => setState({status: 'loaded', ...result}))
            .catch((err) => {
                if ((err as {name?: string}).name === 'AbortError') return
                setState({status: 'error', text: '', truncated: false})
            })
        return () => controller.abort()
    }, [src])

    if (state.status === 'loading') return <PreviewStatus label="Loading preview…"/>
    if (state.status === 'error') return <PreviewStatus label="Could not load a preview for this object." isError/>

    return (
        <pre className="object-text-preview">
            {state.text}
            {state.truncated && '\n\n… truncated'}
        </pre>
    )
}

/**
 * Fetches only as much of the object as needed for the preview. Stops
 * reading (and cancels the underlying connection) once TEXT_PREVIEW_LIMIT
 * characters have been decoded, instead of buffering the full response —
 * important for large text-like objects, since res.text() would otherwise
 * transfer and hold the entire body in memory just to show the first slice.
 */
async function readTextPreview(src: string, signal: AbortSignal): Promise<{text: string; truncated: boolean}> {
    const res = await fetch(src, {signal})
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    let truncated: boolean
    try {
        while (text.length < TEXT_PREVIEW_LIMIT) {
            const {done, value} = await reader.read()
            if (done) break
            text += decoder.decode(value, {stream: true})
        }
        if (text.length > TEXT_PREVIEW_LIMIT) {
            text = text.slice(0, TEXT_PREVIEW_LIMIT)
            // A code unit landing exactly on the cut could be the high half of a
            // surrogate pair (e.g. an emoji) with its low half past the boundary —
            // slice() doesn't know that, and leaves a lone surrogate that renders
            // as a replacement glyph. Drop it so the preview only ever ends on a
            // complete character.
            const lastCode = text.charCodeAt(text.length - 1)
            if (lastCode >= 0xd800 && lastCode <= 0xdbff) text = text.slice(0, -1)
            truncated = true
        } else {
            // Confirm whether more data was actually available before claiming
            // completeness — the loop can exit exactly at the limit.
            const {done} = await reader.read()
            truncated = !done
        }
    } finally {
        void reader.cancel().catch(() => {})
    }
    return {text, truncated}
}

function PreviewStatus({label, isError}: {label: string; isError?: boolean}) {
    return (
        <div className="image-preview-status">
            {isError ? <AlertTriangle size={20}/> : <Loader2 size={20} className="spin"/>}
            <span>{label}</span>
        </div>
    )
}

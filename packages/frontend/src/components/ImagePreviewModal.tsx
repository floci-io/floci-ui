import {useEffect, useState} from 'react'
import {AlertTriangle, Download, Loader2, X} from 'lucide-react'
import type {ObjectPreviewKind} from '@/lib/format'

interface ObjectPreviewModalProps {
    kind: ObjectPreviewKind
    name: string
    /** Plain (attachment) object URL — used for Download and for img/video/audio/text,
     *  since those elements don't act on Content-Disposition the way a top-level or
     *  iframe navigation does. */
    src: string
    /** Inline-disposition URL, only needed by kinds rendered in an <iframe> (pdf). */
    previewSrc: string
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
export function ImagePreviewModal({kind, name, src, previewSrc, onClose}: ObjectPreviewModalProps) {
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
                    {kind === 'pdf' && <iframe className="object-pdf-preview" src={previewSrc} title={name}/>}
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
        let cancelled = false
        setState({status: 'loading', text: '', truncated: false})
        fetch(src)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                return res.text()
            })
            .then((text) => {
                if (cancelled) return
                const truncated = text.length > TEXT_PREVIEW_LIMIT
                setState({status: 'loaded', text: truncated ? text.slice(0, TEXT_PREVIEW_LIMIT) : text, truncated})
            })
            .catch(() => {
                if (!cancelled) setState({status: 'error', text: '', truncated: false})
            })
        return () => { cancelled = true }
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

function PreviewStatus({label, isError}: {label: string; isError?: boolean}) {
    return (
        <div className="image-preview-status">
            {isError ? <AlertTriangle size={20}/> : <Loader2 size={20} className="spin"/>}
            <span>{label}</span>
        </div>
    )
}

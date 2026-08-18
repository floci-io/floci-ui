import {useState} from 'react'
import {File, FileAudio, FileSpreadsheet, FileText, FileType, FileVideo, Image} from 'lucide-react'
import type {ObjectIconKind} from '@/lib/format'

interface ObjectThumbnailProps {
    kind: ObjectIconKind
    src: string
    name: string
    /** Whether fetching object content (the Download action) is currently allowed. */
    canLoad: boolean
}

const KIND_ICON: Record<Exclude<ObjectIconKind, 'image'>, typeof File> = {
    video: FileVideo,
    audio: FileAudio,
    text: FileText,
    pdf: FileType,
    document: FileText,
    spreadsheet: FileSpreadsheet,
}

/**
 * Row icon for a recognized object type. Images get a real square thumbnail
 * (falling back to the generic file icon on load failure — e.g. the
 * extension heuristic guessed wrong). Every other recognized kind gets a
 * type-specific icon instead of a rendered thumbnail.
 *
 * When `canLoad` is false (download is gated off — runtime unavailable, or
 * the schema disables it), this never issues the image request: it falls
 * back to a static icon instead. Otherwise the thumbnail would fetch object
 * content behind the same capability check the Download button honors.
 */
export function ObjectThumbnail({kind, src, name, canLoad}: ObjectThumbnailProps) {
    const [failed, setFailed] = useState(false)

    if (kind !== 'image' || failed || !canLoad) {
        const Icon = kind === 'image' ? Image : KIND_ICON[kind]
        return <Icon size={14}/>
    }

    return (
        <img
            className="object-thumbnail"
            src={src}
            alt=""
            title={name}
            loading="lazy"
            onError={() => setFailed(true)}
        />
    )
}

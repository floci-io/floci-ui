import {useState} from 'react'
import {File, FileAudio, FileSpreadsheet, FileText, FileType, FileVideo} from 'lucide-react'
import type {ObjectIconKind} from '@/lib/format'

interface ObjectThumbnailProps {
    kind: ObjectIconKind
    src: string
    name: string
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
 */
export function ObjectThumbnail({kind, src, name}: ObjectThumbnailProps) {
    const [failed, setFailed] = useState(false)

    if (kind !== 'image' || failed) {
        const Icon = kind === 'image' ? File : KIND_ICON[kind]
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

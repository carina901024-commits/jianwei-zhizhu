import { useEffect, useState } from 'react'
import { assetRepo } from '../db/repo'
import type { ID } from '../types'

/** 从 assets 表取 Blob 显示为图片（自动释放 objectURL） */
export function AssetImage({ assetId, alt, className, onClick }: {
  assetId: ID
  alt?: string
  className?: string
  onClick?: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    assetRepo.get(assetId).then((a) => {
      if (!alive || !a) return
      objectUrl = URL.createObjectURL(a.blob)
      setUrl(objectUrl)
    })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [assetId])

  if (!url) return <div className={`asset-placeholder ${className ?? ''}`} />
  return <img src={url} alt={alt ?? ''} className={className} onClick={onClick} loading="lazy" />
}

/** 通用底部弹层（移动端友好） */
export function BottomSheet({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

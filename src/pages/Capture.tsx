import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ImageUp, Trash2, PencilLine } from 'lucide-react'
import { assetRepo, draftRepo, newId } from '../db/repo'
import { fileToSourceAsset } from '../services/image'
import { useAppStore } from '../store/appStore'
import type { Draft } from '../types'

// ===== 收题页：拍照 / 相册 / 采集说明 / 最近草稿 =====

export function Capture() {
  const { user } = useAppStore()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const albumRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const load = useCallback(() => {
    if (!user) return
    draftRepo.listByUser(user.id).then((ds) => {
      setDrafts(ds.filter((d) => d.status === 'pending'))
      // 草稿缩略图：取原图 asset 生成 objectURL
      const urls: Record<string, string> = {}
      const revocable: string[] = []
      Promise.all(ds.filter((d) => d.status === 'pending').map(async (d) => {
        const a = await assetRepo.get(d.sourceAssetId)
        if (a) { const u = URL.createObjectURL(a.blob); urls[d.id] = u; revocable.push(u) }
      })).then(() => {
        setSourceUrls((prev) => { Object.values(prev).forEach(URL.revokeObjectURL); return urls })
      })
    })
  }, [user])

  useEffect(() => { load() }, [load])

  async function handleFile(file: File | undefined) {
    if (!file || !user) return
    setBusy(true)
    try {
      const asset = await fileToSourceAsset(file)
      await assetRepo.put(asset)
      navigate(`/crop?asset=${asset.id}`)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      alert(`图片读取失败，请换一张试试\n（原因：${detail}）`)
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="capture-page">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
      <input ref={albumRef} type="file" accept="image/*,image/heic" hidden onChange={(e) => handleFile(e.target.files?.[0])} />

      <div className="capture-actions">
        <button className="capture-btn" disabled={busy} onClick={() => cameraRef.current?.click()}>
          <Camera size={26} />
          <b>{busy ? '处理中…' : '拍照收题'}</b>
          <span>对着作业 / 试卷拍一张</span>
        </button>
        <button className="capture-btn secondary" disabled={busy} onClick={() => albumRef.current?.click()}>
          <ImageUp size={26} />
          <b>相册选图</b>
          <span>从手机相册选择已有照片</span>
        </button>
      </div>

      <div className="capture-tips">
        <b>采集小贴士</b>
        <ul>
          <li>光线充足、页面平整，题目拍得更清晰</li>
          <li>一张图里有几道题没关系，下一步可以框选多题</li>
          <li>拍完可以擦掉手写答案，复习时重做更有效</li>
        </ul>
      </div>

      {drafts.length > 0 && (
        <div className="draft-section">
          <h3>最近草稿（{drafts.length}）</h3>
          <p className="muted">框选后未加工完成的题目，点击继续</p>
          <div className="draft-list">
            {drafts.map((d) => (
              <div key={d.id} className="draft-item">
                <img src={sourceUrls[d.id]} className="draft-thumb" alt="" />
                <div className="draft-box-outline" style={{
                  left: `${d.box.x * 100}%`, top: `${d.box.y * 100}%`,
                  width: `${d.box.w * 100}%`, height: `${d.box.h * 100}%`,
                }} />
                <div className="draft-info">
                  <b>{d.title}</b>
                  <span>{d.questionDate}</span>
                </div>
                <button className="icon-btn" onClick={() => navigate(`/crop?asset=${d.sourceAssetId}`)} title="继续加工"><PencilLine size={18} /></button>
                <button className="icon-btn danger" onClick={async () => { await draftRepo.delete(d.id); load() }} title="删除草稿"><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

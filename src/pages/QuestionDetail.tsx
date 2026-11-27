import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Trash2, PencilLine, Dumbbell, Plus, Save,
} from 'lucide-react'
import dayjs from 'dayjs'
import { assetRepo, questionRepo, reviewRepo, subjectRepo, categoryRepo, newId, today } from '../db/repo'
import { fileToSourceAsset } from '../services/image'
import { dueLabel } from '../services/review'
import { useAppStore } from '../store/appStore'
import { AssetImage } from '../components/AssetImage'
import { vocabName } from '../components/VocabChips'
import type { Question, Review } from '../types'
import { MAX_AUX_IMAGES } from '../types'

// ===== 错题详情：大图 / 状态 / 复习历史 / 笔记 / 附图 / 编辑删除重练 =====

export function QuestionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  // 所有 Hooks 必须在条件 return 之前调用（此前 vocabs 放在 return 之后导致详情页空白）
  const { subjects, categories, vocabs } = useAppStore()
  const [q, setQ] = useState<Question | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  const auxInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!id) return
    const question = await questionRepo.get(id)
    if (!question) { navigate('/', { replace: true }); return }
    setQ(question)
    setNote(question.note ?? '')
    reviewRepo.byQuestion(id).then(setReviews)
    // 附图缩略 URL
    const urls: Record<string, string> = {}
    for (const aid of question.auxAssetIds ?? []) {
      const a = await assetRepo.get(aid)
      if (a) urls[aid] = URL.createObjectURL(a.blob)
    }
    setThumbUrls((prev) => { Object.values(prev).forEach(URL.revokeObjectURL); return urls })
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  if (!q) return <div className="page-loading">加载中…</div>

  const subject = subjects.find((s) => s.id === q.subjectId)
  const category = categories.find((c) => c.id === q.categoryId)
  const grade = vocabName(vocabs, q.gradeId)
  const qtype = vocabName(vocabs, q.questionTypeId)
  const reason = vocabName(vocabs, q.errorReasonId)

  async function addAux(file: File | undefined) {
    if (!file || !q) return
    if ((q.auxAssetIds ?? []).length >= MAX_AUX_IMAGES) {
      alert(`附图最多 ${MAX_AUX_IMAGES} 张`)
      return
    }
    const asset = await fileToSourceAsset(file)
    asset.kind = 'aux'
    await assetRepo.put(asset)
    q.auxAssetIds = [...(q.auxAssetIds ?? []), asset.id]
    q.updatedAt = new Date().toISOString()
    await questionRepo.put(q)
    load()
  }

  async function removeAux(aid: string) {
    if (!q) return
    q.auxAssetIds = (q.auxAssetIds ?? []).filter((x) => x !== aid)
    q.updatedAt = new Date().toISOString()
    await questionRepo.put(q)
    await assetRepo.delete(aid)
    load()
  }

  async function saveNote() {
    if (!q) return
    setSavingNote(true)
    q.note = note.trim() || undefined
    q.updatedAt = new Date().toISOString()
    await questionRepo.put(q)
    setSavingNote(false)
    alert('笔记已保存')
  }

  async function repractice() {
    if (!q) return
    // R4：已掌握题手动重练——直接把 nextReviewAt 提前到今天，进入队列
    q.nextReviewAt = today()
    q.updatedAt = new Date().toISOString()
    await questionRepo.put(q)
    navigate('/review/session')
  }

  return (
    <div className="detail-page">
      <div className="detail-image">
        <AssetImage assetId={q.mainAssetId} alt={q.title} />
      </div>

      <div className="detail-head">
        <h2>{q.title}</h2>
        <div className="q-meta">
          {subject && <span className="tag" style={{ background: subject.color }}>{subject.name}</span>}
          {category && <span className="tag tag-soft">{category.name}</span>}
          {grade && <span className="tag tag-soft">{grade}</span>}
          {qtype && <span className="tag tag-soft">{qtype}</span>}
          {reason && <span className="tag tag-reason">{reason}</span>}
          <span className="q-date">{q.questionDate}</span>
        </div>
        <div className="q-meta">
          <span className={`tag ${q.status === 'mastered' ? 'tag-mastered' : 'tag-learning'}`}>
            {q.status === 'mastered' ? '✓ 已掌握' : '待攻克'}
          </span>
          <span className="muted small">累计答对 {q.correctCount} 次 · 复习 {q.reviewCount} 次 · {dueLabel(q)}</span>
        </div>
        <div className="detail-actions">
          <button className="btn-ghost" onClick={() => navigate(`/crop?question=${q.id}`)}><PencilLine size={15} /> 重新加工</button>
          {q.status === 'mastered' && (
            <button className="btn-ghost" onClick={repractice}><Dumbbell size={15} /> 重练</button>
          )}
          <button className="btn-ghost danger" onClick={async () => {
            if (confirm('删除后进入回收站，可在首页恢复。确定删除吗？')) {
              await questionRepo.softDelete(q.id)
              navigate('/')
            }
          }}><Trash2 size={15} /> 删除</button>
        </div>
      </div>

      <div className="detail-section">
        <h3>题目文字</h3>
        {q.ocrText ? (
          <p className="ocr-display">{q.ocrText}</p>
        ) : (
          <p className="muted small">未识别题目文字。可在「重新加工」中使用 OCR 识别。</p>
        )}
      </div>

      <div className="detail-section">
        <h3>笔记</h3>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="记录错因、思路…" />
        <button className="btn-ghost" onClick={saveNote} disabled={savingNote}><Save size={14} /> {savingNote ? '保存中…' : '保存笔记'}</button>
      </div>

      <div className="detail-section">
        <h3>附图（{q.auxAssetIds?.length ?? 0}/{MAX_AUX_IMAGES}）</h3>
        <p className="muted small">附图仅在详情和复习时可见，不进练习卷</p>
        <div className="aux-grid">
          {(q.auxAssetIds ?? []).map((aid) => (
            <div key={aid} className="aux-item">
              <img src={thumbUrls[aid]} alt="附图" />
              <button className="aux-del" onClick={() => removeAux(aid)}>×</button>
            </div>
          ))}
          {(q.auxAssetIds?.length ?? 0) < MAX_AUX_IMAGES && (
            <button className="aux-add" onClick={() => auxInputRef.current?.click()}><Plus size={20} /></button>
          )}
        </div>
        <input ref={auxInputRef} type="file" accept="image/*" hidden onChange={(e) => { addAux(e.target.files?.[0]); e.target.value = '' }} />
      </div>

      <div className="detail-section">
        <h3>复习历史（{reviews.length}）</h3>
        {reviews.length === 0 ? (
          <p className="muted">还没有复习记录</p>
        ) : (
          <ul className="review-history">
            {reviews.map((r) => (
              <li key={r.id}>
                <span className={r.result === 'correct' ? 'ok' : 'bad'}>{r.result === 'correct' ? '✓ 答对' : '✗ 答错'}</span>
                <span className="muted">{dayjs(r.reviewedAt).format('YYYY-MM-DD HH:mm')}</span>
                <span className="muted small">累计答对 {r.correctCountAfter} 次</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

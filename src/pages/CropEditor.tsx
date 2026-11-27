import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Undo2, Redo2, Eraser, Save, Eye, RotateCw, Droplets, ScanText, Trash2, SaveAll, Maximize2, ScanLine,
} from 'lucide-react'
import dayjs from 'dayjs'
import {
  assetRepo, draftRepo, questionRepo, newId, today,
} from '../db/repo'
import {
  newEditState, pushStroke, undo as undoStroke, redo as redoStroke, makeThumbAsset, whitenImageData, loadDrawable, drawableSize,
} from '../services/image'
import type { EditState, Stroke } from '../services/image'
import { ocrRecognize, ocrStatusLabel } from '../services/ocr'
import { useAppStore } from '../store/appStore'
import { VocabChipRow } from '../components/VocabChips'
import type { Box, Draft, ID, Question } from '../types'

// ===== 框选 + 图片加工 一体化页面 =====
// 模式：
//  - source：拍照/相册新图 → 框选多题 → 选中某框即在下方加工（橡皮擦/撤销重做/旋转/变白/OCR）→ 保存本题 / 保存全部
//  - reedit：已有错题重新加工（/crop?question=id），不显示框选
// 离开页面时未保存的框自动存为草稿，可从收题页继续

type Mode = 'source' | 'reedit'

interface BoxWork {
  edit: EditState
  ocrText: string
  title: string
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: { key: Handle; style: React.CSSProperties }[] = [
  { key: 'nw', style: { left: -6, top: -6, cursor: 'nwse-resize' } },
  { key: 'n', style: { left: '50%', top: -6, marginLeft: -6, cursor: 'ns-resize' } },
  { key: 'ne', style: { right: -6, top: -6, cursor: 'nesw-resize' } },
  { key: 'e', style: { right: -6, top: '50%', marginTop: -6, cursor: 'ew-resize' } },
  { key: 'se', style: { right: -6, bottom: -6, cursor: 'nwse-resize' } },
  { key: 's', style: { left: '50%', bottom: -6, marginLeft: -6, cursor: 'ns-resize' } },
  { key: 'sw', style: { left: -6, bottom: -6, cursor: 'nesw-resize' } },
  { key: 'w', style: { left: -6, top: '50%', marginTop: -6, cursor: 'ew-resize' } },
]

const MIN_SIZE = 0.05

function boxKey(b: Box): string {
  return `${b.x.toFixed(4)},${b.y.toFixed(4)},${b.w.toFixed(4)},${b.h.toFixed(4)}`
}

export function CropEditor() {
  const [sp] = useSearchParams()
  const assetParam = sp.get('asset')
  const questionParam = sp.get('question')
  const mode: Mode = questionParam ? 'reedit' : 'source'
  const { user, subjects, categories } = useAppStore()
  const navigate = useNavigate()

  // ===== 图片 / 画布 =====
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const baseBlobRef = useRef<Blob | null>(null) // source=原图；reedit=原题底图资产
  const cropBlobRef = useRef<Blob | null>(null) // 当前题未加工的裁剪图（original / 对照）
  const [cropUrl, setCropUrl] = useState<string | null>(null) // 原图对照
  const composedRef = useRef<HTMLCanvasElement | null>(null)
  const curStrokeRef = useRef<Stroke | null>(null)
  const displayRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // ===== 框选（source 模式） =====
  const [boxes, setBoxes] = useState<Box[]>([])
  const [works, setWorks] = useState<BoxWork[]>([])
  const [draftIds, setDraftIds] = useState<(ID | null)[]>([])
  const [selected, setSelected] = useState(-1)
  const dragRef = useRef<{ mode: 'move' | Handle | 'create'; boxIdx: number; startX: number; startY: number; orig: Box } | null>(null)
  const boxesRef = useRef(boxes); boxesRef.current = boxes
  const worksRef = useRef(works); worksRef.current = works
  const draftIdsRef = useRef(draftIds); draftIdsRef.current = draftIds
  const selectedRef = useRef(selected); selectedRef.current = selected

  // ===== 设置 =====
  const [subjectId, setSubjectId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [gradeId, setGradeId] = useState<ID | undefined>(undefined)
  const [questionTypeId, setQuestionTypeId] = useState<ID | undefined>(undefined)
  const [errorReasonId, setErrorReasonId] = useState<ID | undefined>(undefined)
  const [questionDate, setQuestionDate] = useState(today())
  const [note, setNote] = useState('')
  const setRef = useRef({ subjectId, categoryId, gradeId, questionTypeId, errorReasonId, questionDate, note })
  setRef.current = { subjectId, categoryId, gradeId, questionTypeId, errorReasonId, questionDate, note }

  // ===== 状态 =====
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [brushSize, setBrushSize] = useState(0.05)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState('')

  const isReedit = mode === 'reedit'
  const editingQuestionRef = useRef<Question | null>(null)

  // ===== 加载 =====
  useEffect(() => {
    let alive = true
    async function load() {
      try {
        if (!user) return
        if (isReedit) {
          const q = questionParam ? await questionRepo.get(questionParam) : undefined
          if (!q) { navigate('/', { replace: true }); return }
          editingQuestionRef.current = q
          const baseAsset = await assetRepo.get(q.originalAssetId ?? q.mainAssetId)
          if (!baseAsset) { navigate('/', { replace: true }); return }
          baseBlobRef.current = baseAsset.blob
          cropBlobRef.current = baseAsset.blob
          const u = URL.createObjectURL(baseAsset.blob)
          setCropUrl(u); setImgUrl(u)
          setBoxes([{ x: 0, y: 0, w: 1, h: 1 }])
          setWorks([{ edit: newEditState(), ocrText: q.ocrText ?? '', title: q.title }])
          setDraftIds([null])
          setSelected(0)
          setSubjectId(q.subjectId)
          setCategoryId(q.categoryId ?? '')
          setGradeId(q.gradeId)
          setQuestionTypeId(q.questionTypeId)
          setErrorReasonId(q.errorReasonId)
          setQuestionDate(q.questionDate)
          setNote(q.note ?? '')
        } else if (assetParam) {
          const source = await assetRepo.get(assetParam)
          if (!source) { navigate('/capture', { replace: true }); return }
          baseBlobRef.current = source.blob
          const u = URL.createObjectURL(source.blob)
          setImgUrl(u)
          // 恢复该原图的未完成草稿
          const drafts = (await draftRepo.listByUser(user.id)).filter((d) => d.sourceAssetId === assetParam)
          if (drafts.length > 0) {
            setBoxes(drafts.map((d) => d.box))
            setWorks(drafts.map((d) => ({ edit: newEditState(), ocrText: '', title: d.title })))
            setDraftIds(drafts.map((d) => d.id))
            setSubjectId(drafts[0].subjectId)
            setCategoryId(drafts[0].categoryId ?? '')
            setGradeId(drafts[0].gradeId)
            setQuestionTypeId(drafts[0].questionTypeId)
            setErrorReasonId(drafts[0].errorReasonId)
            setQuestionDate(drafts[0].questionDate)
            setSelected(0)
          } else {
            // 默认整个图片内容区域为题目内容区域
            setBoxes([{ x: 0, y: 0, w: 1, h: 1 }])
            setWorks([{ edit: newEditState(), ocrText: '', title: '' }])
            setDraftIds([null])
            setSelected(0)
          }
        } else {
          navigate('/capture', { replace: true })
          return
        }
        if (alive) setReady(true)
      } catch (e) {
        console.error(e)
        alert('图片加载失败')
        navigate(isReedit ? '/' : '/capture', { replace: true })
      }
    }
    load()
    return () => { alive = false }
  }, [isReedit, assetParam, questionParam, user, navigate])

  // 离开页面：未保存的框自动存草稿（仅 source 模式）
  useEffect(() => {
    if (isReedit) return
    return () => {
      const bs = boxesRef.current
      if (bs.length === 0 || !assetParam || !user) return
      const s = setRef.current
      ;(async () => {
        try {
          for (const id of draftIdsRef.current) { if (id) void draftRepo.delete(id) }
          const date = dayjs(s.questionDate).format('MMDD')
          for (let i = 0; i < bs.length; i++) {
            const sid = s.subjectId || subjects[0]?.id || 'sub-math'
            const d: Draft = {
              id: newId(),
              userId: user.id,
              sourceAssetId: assetParam,
              box: bs[i],
              subjectId: sid,
              categoryId: s.categoryId || undefined,
              gradeId: s.gradeId,
              questionTypeId: s.questionTypeId,
              errorReasonId: s.errorReasonId,
              questionDate: s.questionDate,
              status: 'pending',
              title: worksRef.current[i]?.title?.trim() || `${subjects.find((x) => x.id === sid)?.name ?? ''}错题 ${date}-${i + 1}`,
              createdAt: new Date().toISOString(),
            }
            await draftRepo.put(d)
          }
        } catch (e) { console.error('草稿保存失败', e) }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReedit, assetParam, user])

  // 默认学科
  useEffect(() => { if (!subjectId && subjects.length > 0) setSubjectId(subjects[0].id) }, [subjects, subjectId])

  const subjCats = useMemo(() => categories.filter((c) => c.subjectId === subjectId), [categories, subjectId])
  const subject = useMemo(() => subjects.find((s) => s.id === subjectId), [subjects, subjectId])
  const selBox = selected >= 0 && selected < boxes.length ? boxes[selected] : null
  const selBoxGeom = selBox ? boxKey(selBox) : ''
  const selWork: BoxWork | null = selBox ? (works[selected] ?? { edit: newEditState(), ocrText: '', title: '' }) : null
  const selEdit: EditState = selWork?.edit ?? newEditState()

  // 框几何变化 → 该框加工状态重置（擦除笔迹坐标随裁剪区域失效）
  const prevGeomRef = useRef<string>('')
  useEffect(() => {
    if (isReedit) { prevGeomRef.current = selBoxGeom; return }
    if (prevGeomRef.current && prevGeomRef.current !== selBoxGeom && selected >= 0 && selected < works.length) {
      const w = works[selected]
      setWorks((prev) => {
        const next = [...prev]
        next[selected] = { ...w, edit: newEditState(), ocrText: '' }
        return next
      })
    }
    prevGeomRef.current = selBoxGeom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selBoxGeom, selected, isReedit])

  // ===== 为当前选中框重建：底图裁剪 → 合成画布（旋转/变白，不含笔迹） =====
  const rebuildForSelection = useCallback(async (idx?: number) => {
    const i = idx ?? selectedRef.current
    const b = i >= 0 && i < boxesRef.current.length ? boxesRef.current[i] : null
    const w = worksRef.current[i]
    if (!b || !w || !baseBlobRef.current) return
    let drawable
    if (isReedit) {
      drawable = await loadDrawable(baseBlobRef.current)
    } else {
      const blob = await cropBlobFromSource(baseBlobRef.current, b)
      cropBlobRef.current = blob
      setCropUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
      drawable = await loadDrawable(blob)
    }
    const { width: dw, height: dh } = drawableSize(drawable)
    const swapped = w.edit.rotate === 90 || w.edit.rotate === 270
    const canvas = document.createElement('canvas')
    canvas.width = swapped ? dh : dw
    canvas.height = swapped ? dw : dh
    const ctx = canvas.getContext('2d')!
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((w.edit.rotate * Math.PI) / 180)
    ctx.drawImage(drawable, -dw / 2, -dh / 2)
    ctx.restore()
    if (drawable instanceof ImageBitmap) drawable.close()
    if (w.edit.whiten) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      whitenImageData(data)
      ctx.putImageData(data, 0, 0)
    }
    composedRef.current = canvas
    redraw(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReedit])

  const redraw = useCallback((idx?: number) => {
    const i = idx ?? selectedRef.current
    const composed = composedRef.current
    const display = displayRef.current
    if (!composed || !display || i < 0) return
    if (display.width !== composed.width || display.height !== composed.height) {
      display.width = composed.width
      display.height = composed.height
    }
    const ctx = display.getContext('2d')!
    // 擦除底色为白色：白色笔刷覆盖笔迹
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, display.width, display.height)
    ctx.drawImage(composed, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const work = worksRef.current[i]
    if (work) {
      const all = work.edit.strokes.slice(0, work.edit.strokeIndex)
      if (curStrokeRef.current) all.push(curStrokeRef.current)
      for (const stroke of all) drawStrokePath(ctx, stroke, display.width)
    }
  }, [])

  useEffect(() => {
    if (ready && selBox) rebuildForSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selected, selBoxGeom, selEdit.rotate, selEdit.whiten])
  useEffect(() => { redraw() }, [redraw, selEdit.strokes, selEdit.strokeIndex])

  // ===== 擦除交互（作用于当前选中框） =====
  function toCanvasCoords(e: React.PointerEvent): { x: number; y: number } {
    const canvas = displayRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    if (showOriginal || !selBox) return
    const p = toCanvasCoords(e)
    curStrokeRef.current = { size: brushSize, points: [p] }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    const cur = curStrokeRef.current
    if (!cur) return
    const p = toCanvasCoords(e)
    const last = cur.points[cur.points.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.002) return
    cur.points.push(p)
    const canvas = displayRef.current!
    const ctx = canvas.getContext('2d')!
    // 白色笔刷：擦除底色为白色
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(2, cur.size * canvas.width)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.x * canvas.width, last.y * canvas.height)
    ctx.lineTo(p.x * canvas.width, p.y * canvas.height)
    ctx.stroke()
  }

  function onCanvasPointerUp() {
    const cur = curStrokeRef.current
    curStrokeRef.current = null
    const i = selectedRef.current
    if (!cur || i < 0 || i >= worksRef.current.length) return
    setWorks((prev) => {
      const next = [...prev]
      if (!next[i]) return prev
      next[i] = { ...next[i], edit: pushStroke(next[i].edit, cur) }
      return next
    })
  }

  function updateSelWork(patch: Partial<BoxWork>) {
    const i = selectedRef.current
    if (i < 0) return
    setWorks((prev) => {
      const next = [...prev]
      if (!next[i]) return prev
      next[i] = { ...next[i], ...patch }
      return next
    })
  }

  // ===== 框选指针交互（source 模式，作用于大图） =====
  function toNorm(e: React.PointerEvent): { x: number; y: number } {
    const rect = imgRef.current!.getBoundingClientRect()
    return {
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
    }
  }

  function onStagePointerDown(e: React.PointerEvent) {
    const el = e.target as HTMLElement
    const p = toNorm(e)
    if (el.dataset.handle && selected >= 0) {
      dragRef.current = { mode: el.dataset.handle as Handle, boxIdx: selected, startX: p.x, startY: p.y, orig: { ...boxes[selected] } }
    } else if (el.dataset.boxIdx) {
      const idx = Number(el.dataset.boxIdx)
      setSelected(idx)
      dragRef.current = { mode: 'move', boxIdx: idx, startX: p.x, startY: p.y, orig: { ...boxes[idx] } }
    } else {
      // 默认整图为题目区域：在未加工的默认全图框上直接拖新框 = 更新题目内容区域（替换而非新增）
      const isUntouchedFullBox = boxes.length === 1
        && boxes[0].x === 0 && boxes[0].y === 0 && boxes[0].w === 1 && boxes[0].h === 1
        && works[0] && works[0].edit.strokeIndex === 0 && works[0].edit.rotate === 0
        && !works[0].edit.whiten && !works[0].ocrText
      if (isUntouchedFullBox) {
        setWorks((prev) => {
          const next = [...prev]
          next[0] = { edit: newEditState(), ocrText: '', title: '' }
          return next
        })
        setSelected(0)
        dragRef.current = { mode: 'create', boxIdx: 0, startX: p.x, startY: p.y, orig: { x: p.x, y: p.y, w: 0, h: 0 } }
      } else {
        const idx = boxes.length
        setBoxes((prev) => [...prev, { x: p.x, y: p.y, w: 0, h: 0 }])
        setWorks((prev) => [...prev, { edit: newEditState(), ocrText: '', title: '' }])
        setDraftIds((prev) => [...prev, null])
        setSelected(idx)
        dragRef.current = { mode: 'create', boxIdx: idx, startX: p.x, startY: p.y, orig: { x: p.x, y: p.y, w: 0, h: 0 } }
      }
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function onStagePointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const p = toNorm(e)
    const dx = p.x - d.startX
    const dy = p.y - d.startY
    setBoxes((prev) => {
      const next = [...prev]
      const b = { ...d.orig }
      if (d.mode === 'move') {
        b.x = clamp(d.orig.x + dx)
        b.y = clamp(d.orig.y + dy)
        b.x = Math.min(b.x, 1 - d.orig.w)
        b.y = Math.min(b.y, 1 - d.orig.h)
      } else if (d.mode === 'create') {
        b.x = Math.min(d.startX, p.x)
        b.y = Math.min(d.startY, p.y)
        b.w = Math.abs(dx)
        b.h = Math.abs(dy)
      } else {
        applyHandle(b, d.mode, dx, dy)
      }
      next[d.boxIdx] = b
      return next
    })
  }

  function onStagePointerUp() {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    setBoxes((prev) => {
      const b = prev[d.boxIdx]
      if (d.mode === 'create' && (b.w < MIN_SIZE || b.h < MIN_SIZE)) {
        removeBoxAt(d.boxIdx)
        return prev
      }
      const next = [...prev]
      const b2 = { ...b }
      if (d.mode !== 'move') {
        if (b2.w < MIN_SIZE) b2.w = MIN_SIZE
        if (b2.h < MIN_SIZE) b2.h = MIN_SIZE
        next[d.boxIdx] = b2
      }
      return next
    })
  }

  function removeBoxAt(idx: number) {
    setBoxes((prev) => prev.filter((_, i) => i !== idx))
    setWorks((prev) => prev.filter((_, i) => i !== idx))
    setDraftIds((prev) => prev.filter((_, i) => i !== idx))
    setSelected((s) => (s === idx ? -1 : s > idx ? s - 1 : s))
    if (selectedRef.current === idx) prevGeomRef.current = ''
  }

  function autoTitle(n: number): string {
    return `${subject?.name ?? ''}错题 ${dayjs(questionDate).format('MMDD')}-${n}`
  }

  /** 标题兜底：用户未填时自动生成「学科错题 MMDD-序号」 */
  function effectiveTitle(i: number): string {
    const t = worksRef.current[i]?.title?.trim()
    if (t) return t
    return `${subject?.name ?? ''}错题 ${dayjs(setRef.current.questionDate).format('MMDD')}-${i + 1}`
  }

  function applyHandle(b: Box, h: Handle, dx: number, dy: number) {
    let { x, y, w, h: bh } = b
    if (h.includes('w')) { x = clamp(b.x + dx); w = b.w + (b.x - x) }
    if (h.includes('e')) { w = clamp(b.x + b.w + dx) - b.x }
    if (h.includes('n')) { y = clamp(b.y + dy); bh = b.h + (b.y - y) }
    if (h.includes('s')) { bh = clamp(b.y + b.h + dy) - b.y }
    if (w < 0) { x += w; w = -w }
    if (bh < 0) { y += bh; bh = -bh }
    b.x = x; b.y = y; b.w = Math.max(MIN_SIZE, w); b.h = Math.max(MIN_SIZE, bh)
  }

  // ===== OCR =====
  async function runOCR() {
    if (ocrBusy || !composedRef.current || !selBox) return
    setOcrBusy(true)
    setOcrProgress('准备中…')
    try {
      const text = await ocrRecognize(composedRef.current, (status, progress) =>
        setOcrProgress(ocrStatusLabel(status, progress)))
      if (!text) {
        alert('未识别到文字，请确认图片清晰度。几何图形无法识别，请以原图为准。')
      } else {
        updateSelWork({ ocrText: text })
        const curTitle = worksRef.current[selectedRef.current]?.title ?? ''
        if (!curTitle.trim() || /错题 \d{4}-\d+$/.test(curTitle)) {
          const firstLine = text.split('\n')[0].replace(/\s+/g, ' ').slice(0, 12)
          if (firstLine) updateSelWork({ title: firstLine })
        }
      }
    } catch (e) {
      console.error(e)
      alert('OCR 识别失败：首次使用需联网下载中英文模型，请检查网络后重试')
    } finally {
      setOcrBusy(false)
      setOcrProgress('')
    }
  }

  // ===== 烘焙当前选中框 → processed / thumb / original 资产 =====
  async function bakeCurrentAssets(): Promise<{ processedAssetId: ID; answerErased: boolean }> {
    const i = selectedRef.current
    const work = worksRef.current[i]
    const composed = composedRef.current!
    const display = displayRef.current!
    const final = document.createElement('canvas')
    final.width = display.width
    final.height = display.height
    const fctx = final.getContext('2d')!
    fctx.fillStyle = '#ffffff'
    fctx.fillRect(0, 0, final.width, final.height)
    fctx.drawImage(composed, 0, 0)
    fctx.lineCap = 'round'
    fctx.lineJoin = 'round'
    for (const stroke of work.edit.strokes.slice(0, work.edit.strokeIndex)) drawStrokePath(fctx, stroke, final.width)
    const processedBlob = await canvasToBlob(final)
    const now = new Date().toISOString()
    const processedAsset = {
      id: newId(), blob: processedBlob, width: final.width, height: final.height,
      mime: 'image/jpeg', kind: 'processed' as const, createdAt: now,
    }
    await assetRepo.put(processedAsset)
    const thumb = await makeThumbAsset(processedAsset)
    await assetRepo.put(thumb)
    return { processedAssetId: processedAsset.id, answerErased: work.edit.strokeIndex > 0 }
  }

  // ===== 保存当前选中的题（source 模式） =====
  async function saveCurrent() {
    if (!user || saving || isReedit || !selBox || !selWork) return
    if (!subjectId) { alert('学科必选'); return }
    setSaving(true)
    try {
      const { processedAssetId, answerErased } = await bakeCurrentAssets()
      const now = new Date().toISOString()
      // 原始未擦除图落库（原图对照 / 导出原始答案）
      let originalAssetId: ID | undefined
      if (cropBlobRef.current) {
        const drawable = await loadDrawable(cropBlobRef.current)
        const { width, height } = drawableSize(drawable)
        if (drawable instanceof ImageBitmap) drawable.close()
        const origAsset = {
          id: newId(), blob: cropBlobRef.current, width, height,
          mime: 'image/jpeg', kind: 'original' as const, createdAt: now,
        }
        await assetRepo.put(origAsset)
        originalAssetId = origAsset.id
      }
      const s = setRef.current
      const q: Question = {
        id: newId(),
        userId: user.id,
        subjectId,
        categoryId: s.categoryId || undefined,
        gradeId: s.gradeId,
        questionTypeId: s.questionTypeId,
        errorReasonId: s.errorReasonId,
        title: effectiveTitle(selected),
        questionDate: s.questionDate,
        status: 'learning',
        correctCount: 0,
        reviewCount: 0,
        nextReviewAt: today(), // R2：新题入库即进入待复习
        mainAssetId: processedAssetId,
        originalAssetId,
        auxAssetIds: [],
        answerErased,
        ocrText: selWork.ocrText.trim() || undefined,
        note: s.note.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      }
      await questionRepo.put(q)
      const draftId = draftIds[selected]
      if (draftId) await draftRepo.delete(draftId)
      const idx = selected
      prevGeomRef.current = ''
      removeBoxAt(idx)
      if (boxesRef.current.length === 0) navigate('/')
      else setSelected(Math.min(idx, boxesRef.current.length - 1))
    } catch (e) {
      console.error(e)
      alert('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  // ===== 保存全部框（source 模式） =====
  async function saveAll() {
    if (!user || saving || isReedit) return
    if (boxes.length === 0) { alert('请先在图上拖拽框选题目'); return }
    if (!subjectId) { alert('学科必选'); return }
    setSaving(true)
    try {
      const s = setRef.current
      const now0 = new Date().toISOString()
      for (let i = 0; i < boxes.length; i++) {
        setSelected(i)
        await rebuildForSelection(i)
        const { processedAssetId, answerErased } = await bakeCurrentAssetsAt(i)
        const work = worksRef.current[i]
        let originalAssetId: ID | undefined
        if (cropBlobRef.current) {
          const drawable = await loadDrawable(cropBlobRef.current)
          const { width, height } = drawableSize(drawable)
          if (drawable instanceof ImageBitmap) drawable.close()
          const origAsset = {
            id: newId(), blob: cropBlobRef.current, width, height,
            mime: 'image/jpeg', kind: 'original' as const, createdAt: now0,
          }
          await assetRepo.put(origAsset)
          originalAssetId = origAsset.id
        }
        const q: Question = {
          id: newId(),
          userId: user.id,
          subjectId,
          categoryId: s.categoryId || undefined,
          gradeId: s.gradeId,
          questionTypeId: s.questionTypeId,
          errorReasonId: s.errorReasonId,
          title: effectiveTitle(i),
          questionDate: s.questionDate,
          status: 'learning',
          correctCount: 0,
          reviewCount: 0,
          nextReviewAt: today(),
          mainAssetId: processedAssetId,
          originalAssetId,
          auxAssetIds: [],
          answerErased,
          ocrText: work.ocrText.trim() || undefined,
          note: s.note.trim() || undefined,
          createdAt: now0,
          updatedAt: now0,
        }
        await questionRepo.put(q)
        const draftId = draftIds[i]
        if (draftId) await draftRepo.delete(draftId)
      }
      navigate('/')
    } catch (e) {
      console.error(e)
      alert('批量保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  /** 按指定框烘焙资产（saveAll 用） */
  async function bakeCurrentAssetsAt(i: number): Promise<{ processedAssetId: ID; answerErased: boolean }> {
    const work = worksRef.current[i]
    const composed = composedRef.current!
    const display = displayRef.current!
    const final = document.createElement('canvas')
    final.width = display.width
    final.height = display.height
    const fctx = final.getContext('2d')!
    fctx.fillStyle = '#ffffff'
    fctx.fillRect(0, 0, final.width, final.height)
    fctx.drawImage(composed, 0, 0)
    fctx.lineCap = 'round'
    fctx.lineJoin = 'round'
    for (const stroke of work.edit.strokes.slice(0, work.edit.strokeIndex)) drawStrokePath(fctx, stroke, final.width)
    const processedBlob = await canvasToBlob(final)
    const now = new Date().toISOString()
    const processedAsset = {
      id: newId(), blob: processedBlob, width: final.width, height: final.height,
      mime: 'image/jpeg', kind: 'processed' as const, createdAt: now,
    }
    await assetRepo.put(processedAsset)
    const thumb = await makeThumbAsset(processedAsset)
    await assetRepo.put(thumb)
    return { processedAssetId: processedAsset.id, answerErased: work.edit.strokeIndex > 0 }
  }

  // ===== 重新加工模式保存：替换主图 =====
  async function saveReedit() {
    if (!user || saving || !isReedit || !selWork) return
    if (!subjectId) { alert('学科必选'); return }
    setSaving(true)
    try {
      const { processedAssetId, answerErased } = await bakeCurrentAssets()
      const q = editingQuestionRef.current!
      q.mainAssetId = processedAssetId
      q.answerErased = q.answerErased || answerErased
      const s = setRef.current
      q.title = selWork.title.trim() || q.title
      q.subjectId = subjectId
      q.categoryId = s.categoryId || undefined
      q.gradeId = s.gradeId
      q.questionTypeId = s.questionTypeId
      q.errorReasonId = s.errorReasonId
      q.questionDate = s.questionDate
      q.ocrText = selWork.ocrText.trim() || undefined
      q.note = s.note.trim() || undefined
      q.updatedAt = new Date().toISOString()
      await questionRepo.put(q)
      navigate(`/questions/${q.id}`)
    } catch (e) {
      console.error(e)
      alert('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  if (!ready || !user) return <div className="page-loading">加载中…</div>

  // ===== 统一渲染：source（大图框选 + 加工面板）/ reedit（仅加工面板） =====
  const toolButtons = selBox && selWork && (
    <div className="editor-tools">
      <button className={`tool-btn${showOriginal ? ' active' : ''}`} onClick={() => setShowOriginal((v) => !v)} title="原图对照">
        <Eye size={18} /> 原图
      </button>
      <button className="tool-btn" onClick={() => updateSelWork({ edit: undoStroke(selWork.edit) })} disabled={selWork.edit.strokeIndex <= 0} title="撤销">
        <Undo2 size={18} />
      </button>
      <button className="tool-btn" onClick={() => updateSelWork({ edit: redoStroke(selWork.edit) })} disabled={selWork.edit.strokeIndex >= selWork.edit.strokes.length} title="重做">
        <Redo2 size={18} />
      </button>
      <button className="tool-btn" onClick={() => updateSelWork({ edit: { ...selWork.edit, rotate: ((selWork.edit.rotate + 90) % 360) as EditState['rotate'] } })} title="旋转 90°">
        <RotateCw size={18} />
      </button>
      <button className={`tool-btn${selWork.edit.whiten ? ' active' : ''}`} onClick={() => updateSelWork({ edit: { ...selWork.edit, whiten: !selWork.edit.whiten } })} title="纸张变白">
        <Droplets size={18} /> {selWork.edit.whiten ? '原色' : '变白'}
      </button>
      <div className="brush-slider">
        <Eraser size={16} />
        <input type="range" min={0.02} max={0.15} step={0.005} value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))} />
      </div>
      <button className={`tool-btn ocr-btn${ocrBusy ? ' busy' : ''}`} onClick={runOCR} disabled={ocrBusy} title="OCR 识别（中文/英文/数字/符号）">
        <ScanText size={18} /> {ocrBusy ? ocrProgress || '识别中…' : 'OCR 识别'}
      </button>
    </div>
  )

  const editorForm = selBox && selWork && (
    <div className={isReedit ? 'editor-form' : 'panel editor-panel'}>
      {/* 标题在最上，OCR 题目文字紧随其下 */}
      <input className="title-input" value={selWork.title}
        onChange={(e) => updateSelWork({ title: e.target.value })} placeholder="错题标题" />
      <div className="ocr-text-wrap">
        <textarea
          className="note-input ocr-text"
          value={selWork.ocrText}
          onChange={(e) => updateSelWork({ ocrText: e.target.value })}
          placeholder={'OCR 识别的题目文字显示在此，可手动修正\n支持中文/英文/数字/符号；几何图形请以原图为准'}
          rows={3}
        />
        {selWork.ocrText.length > 0 && (
          <button className="ocr-clear-btn" title="一键清空识别文字"
            onClick={() => updateSelWork({ ocrText: '' })}>✕ 清空</button>
        )}
      </div>
      {isReedit && (
        <>
          <div className="chip-row">
            {subjects.map((s) => (
              <button key={s.id} className={`chip${subjectId === s.id ? ' active' : ''}`}
                style={subjectId === s.id ? { background: s.color, borderColor: s.color } : {}}
                onClick={() => { setSubjectId(s.id); setCategoryId('') }}>{s.name}</button>
            ))}
          </div>
          {subjCats.length > 0 && (
            <div className="chip-row">
              <button className={`chip${categoryId === '' ? ' active' : ''}`} onClick={() => setCategoryId('')}>未分类</button>
              {subjCats.map((c) => (
                <button key={c.id} className={`chip${categoryId === c.id ? ' active' : ''}`} onClick={() => setCategoryId(c.id)}>{c.name}</button>
              ))}
            </div>
          )}
          <VocabChipRow kind="grade" value={gradeId} onChange={setGradeId} />
          <VocabChipRow kind="qtype" value={questionTypeId} onChange={setQuestionTypeId} />
          <VocabChipRow kind="reason" value={errorReasonId} onChange={setErrorReasonId} />
          <div className="form-row inline">
            <label>日期</label>
            <input type="date" value={questionDate} onChange={(e) => setQuestionDate(e.target.value)} />
          </div>
          <textarea className="note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="笔记（可选）：错因、思路提示…" rows={2} />
        </>
      )}
    </div>
  )

  if (isReedit) {
    return (
      <div className="editor-page">
        <div className="editor-canvas-wrap">
          <canvas
            ref={displayRef}
            className="editor-canvas"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            style={{ touchAction: 'none', cursor: showOriginal ? 'default' : 'crosshair' }}
          />
          {showOriginal && cropUrl && <img className="editor-original" src={cropUrl} alt="原图" />}
        </div>
        {toolButtons}
        {editorForm}
        <div className="form-row inline">
          <button className="btn-primary big" onClick={saveReedit} disabled={saving}>
            <Save size={16} /> {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="crop-page">
      <div className="crop-toolbar">
        <span className="muted small">
          <ScanLine size={13} /> 在题目上拖拽画框 → 选中后下方直接加工，逐题或全部保存
        </span>
        <button className="btn-ghost" onClick={() => navigate('/capture')}><Maximize2 size={15} /> 重新选图</button>
      </div>

      {/* 原图 + 框选 */}
      <div className="crop-stage" onPointerDown={onStagePointerDown} onPointerMove={onStagePointerMove} onPointerUp={onStagePointerUp} onPointerCancel={onStagePointerUp}>
        {imgUrl && (
          <div className="crop-img-wrap" ref={imgRef}>
            <img src={imgUrl} className="crop-img" alt="原图" draggable={false} />
            {boxes.map((b, i) => (
              <div
                key={i}
                data-box-idx={i}
                className={`crop-box${i === selected ? ' selected' : ''}`}
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
              >
                <span className="crop-box-label">{i + 1}</span>
                <button
                  className="crop-box-del"
                  onPointerDown={(e) => { e.stopPropagation(); removeBoxAt(i) }}
                  title="移除此框（不保存该题）"
                ><Trash2 size={14} /></button>
                {i === selected && HANDLES.map((h) => (
                  <div key={h.key} data-handle={h.key} className="crop-handle" style={h.style} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {boxes.length > 0 && (
        <div className="chip-row">
          {boxes.map((_, i) => (
            <button key={i} className={`chip${i === selected ? ' active' : ''}`} onClick={() => { prevGeomRef.current = ''; setSelected(i) }}>
              题 {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* 选中框的加工区 */}
      {selBox && selWork && (
        <div className="panel editor-panel">
          <div className="editor-canvas-wrap">
            <canvas
              ref={displayRef}
              className="editor-canvas"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              style={{ touchAction: 'none', cursor: showOriginal ? 'default' : 'crosshair' }}
            />
            {showOriginal && cropUrl && <img className="editor-original" src={cropUrl} alt="原图" />}
          </div>
          {toolButtons}
          {editorForm}
        </div>
      )}

      {/* 批量设置 */}
      <div className="crop-form">
        <div className="form-row">
          <label>学科（必选，批量应用）</label>
          <div className="chip-row">
            {subjects.map((s) => (
              <button key={s.id} className={`chip${subjectId === s.id ? ' active' : ''}`} style={subjectId === s.id ? { background: s.color, borderColor: s.color } : {}} onClick={() => { setSubjectId(s.id); setCategoryId('') }}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
        {subjCats.length > 0 && (
          <div className="form-row">
            <label>分类（可选）</label>
            <div className="chip-row">
              <button className={`chip${categoryId === '' ? ' active' : ''}`} onClick={() => setCategoryId('')}>未分类</button>
              {subjCats.map((c) => (
                <button key={c.id} className={`chip${categoryId === c.id ? ' active' : ''}`} onClick={() => setCategoryId(c.id)}>{c.name}</button>
              ))}
            </div>
          </div>
        )}
        <VocabChipRow kind="grade" value={gradeId} onChange={setGradeId} />
        <VocabChipRow kind="qtype" value={questionTypeId} onChange={setQuestionTypeId} />
        <VocabChipRow kind="reason" value={errorReasonId} onChange={setErrorReasonId} />
        <div className="form-row inline">
          <label>日期</label>
          <input type="date" value={questionDate} onChange={(e) => setQuestionDate(e.target.value)} />
        </div>
        <div className="form-row inline">
          <button className="btn-primary" disabled={saving || selected < 0} onClick={saveCurrent}>
            <Save size={16} /> {saving ? '保存中…' : `保存本题（题 ${selected + 1}）`}
          </button>
          <button className="btn-primary" disabled={saving || boxes.length === 0} onClick={saveAll}>
            <SaveAll size={16} /> 保存全部 {boxes.length} 题
          </button>
        </div>
        <p className="muted small">离开页面时未保存的框会自动存为草稿，可在收题页继续</p>
      </div>
    </div>
  )
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function drawStrokePath(ctx: CanvasRenderingContext2D, stroke: Stroke, canvasW: number) {
  if (stroke.points.length === 0) return
  ctx.strokeStyle = '#ffffff' // 擦除 = 白色笔刷覆盖
  ctx.lineWidth = Math.max(2, stroke.size * canvasW)
  ctx.beginPath()
  ctx.moveTo(stroke.points[0].x * canvasW, stroke.points[0].y * ctx.canvas.height)
  for (const p of stroke.points.slice(1)) ctx.lineTo(p.x * canvasW, p.y * ctx.canvas.height)
  ctx.stroke()
}

async function cropBlobFromSource(blob: Blob, box: Box): Promise<Blob> {
  const drawable = await loadDrawable(blob)
  const { width, height } = drawableSize(drawable)
  const sx = Math.round(box.x * width)
  const sy = Math.round(box.y * height)
  const sw = Math.max(1, Math.round(box.w * width))
  const sh = Math.max(1, Math.round(box.h * height))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  canvas.getContext('2d')!.drawImage(drawable, sx, sy, sw, sh, 0, 0, sw, sh)
  if (drawable instanceof ImageBitmap) drawable.close()
  return canvasToBlob(canvas)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85),
  )
}

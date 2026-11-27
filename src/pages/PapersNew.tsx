import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dice5, ListChecks, Printer } from 'lucide-react'
import { questionRepo } from '../db/repo'
import { buildPaper, pickRandom } from '../services/paper'
import { useAppStore } from '../store/appStore'
import { AssetImage } from '../components/AssetImage'
import type { ID, PaperFilters, Question } from '../types'

// ===== 制作练习卷：筛选 / 随机手动选题 / 排版参数 / 预览 =====

export function PapersNew() {
  const { user, subjects, categories, settings } = useAppStore()
  const navigate = useNavigate()

  const [subjectId, setSubjectId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [status, setStatus] = useState<'all' | 'learning' | 'mastered'>('all')
  const [pool, setPool] = useState<Question[]>([])
  const [mode, setMode] = useState<'random' | 'manual'>('random')
  const [count, setCount] = useState(10)
  const [selectedIds, setSelectedIds] = useState<Set<ID>>(new Set())
  const [defaultScale, setDefaultScale] = useState(0.85)
  const [defaultBlankMm, setDefaultBlankMm] = useState(0)
  const [includeAnswer, setIncludeAnswer] = useState(false)
  const [defaultUseOcrText, setDefaultUseOcrText] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    const filters: PaperFilters = {
      subjectId: subjectId || undefined,
      categoryId: categoryId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      status,
    }
    questionRepo.forPaper(user.id, filters).then(setPool)
  }, [user, subjectId, categoryId, dateFrom, dateTo, status])

  // 常用命名预设（R12）
  useEffect(() => {
    if (!title && settings?.namingPresets?.length) setTitle(settings.namingPresets[0])
  }, [settings, title])

  const subjCats = useMemo(() => categories.filter((c) => c.subjectId === subjectId), [categories, subjectId])

  function toggleSelect(id: ID) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function makePaper() {
    if (!user || !settings) return
    if (pool.length === 0) { alert('题库为空，先去收题吧'); return }
    setBusy(true)
    try {
      let ids: ID[]
      if (mode === 'random') {
        // 抽题数量自动限制：不超过题库上限
        ids = (await pickRandom(pool, count)).map((q) => q.id)
      } else {
        ids = pool.filter((q) => selectedIds.has(q.id)).map((q) => q.id)
        if (ids.length === 0) { alert('请勾选至少一道题'); return }
      }
      const paper = await buildPaper({
        userId: user.id,
        title: title.trim() || `${subjects.find((s) => s.id === subjectId)?.name ?? ''}练习卷`,
        filters: { subjectId: subjectId || undefined, categoryId: categoryId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, status },
        selectedIds: ids,
        defaultScale,
        defaultBlankMm,
        includeAnswer,
        defaultUseOcrText,
      })
      navigate(`/papers/${paper.id}/preview`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="papers-new-page">
      <div className="panel">
        <h3>1 · 筛选题库</h3>
        <div className="chip-row">
          <button className={`chip${subjectId === '' ? ' active' : ''}`} onClick={() => { setSubjectId(''); setCategoryId('') }}>全部学科</button>
          {subjects.map((s) => (
            <button key={s.id} className={`chip${subjectId === s.id ? ' active' : ''}`} onClick={() => { setSubjectId(s.id); setCategoryId('') }}>{s.name}</button>
          ))}
        </div>
        {subjCats.length > 0 && (
          <div className="chip-row">
            <button className={`chip${categoryId === '' ? ' active' : ''}`} onClick={() => setCategoryId('')}>全部分类</button>
            {subjCats.map((c) => (
              <button key={c.id} className={`chip${categoryId === c.id ? ' active' : ''}`} onClick={() => setCategoryId(c.id)}>{c.name}</button>
            ))}
          </div>
        )}
        <div className="chip-row">
          <button className={`chip${status === 'all' ? ' active' : ''}`} onClick={() => setStatus('all')}>全部状态</button>
          <button className={`chip${status === 'learning' ? ' active' : ''}`} onClick={() => setStatus('learning')}>待攻克</button>
          <button className={`chip${status === 'mastered' ? ' active' : ''}`} onClick={() => setStatus('mastered')}>已掌握</button>
        </div>
        <div className="form-row inline">
          <label>日期区间</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="muted">至</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <p className="muted small">符合条件：<b>{pool.length}</b> 题</p>
      </div>

      <div className="panel">
        <h3>2 · 选择题目</h3>
        <div className="chip-row">
          <button className={`chip${mode === 'random' ? ' active' : ''}`} onClick={() => setMode('random')}><Dice5 size={14} /> 随机抽题</button>
          <button className={`chip${mode === 'manual' ? ' active' : ''}`} onClick={() => setMode('manual')}><ListChecks size={14} /> 手动勾选</button>
        </div>
        {mode === 'random' && (
          <div className="form-row inline">
            <label>抽题数量</label>
            <input type="number" min={1} max={Math.max(1, pool.length)} value={Math.min(count, Math.max(1, pool.length))}
              onChange={(e) => setCount(Number(e.target.value))} />
            <span className="muted small">不超过题库上限 {pool.length} 题</span>
          </div>
        )}
        {mode === 'manual' && (
          <div className="pick-list">
            {pool.map((q) => (
              <label key={q.id} className={`pick-item${selectedIds.has(q.id) ? ' checked' : ''}`}>
                <input type="checkbox" checked={selectedIds.has(q.id)} onChange={() => toggleSelect(q.id)} />
                <AssetImage assetId={q.mainAssetId} className="pick-thumb" />
                <span>{q.title}</span>
              </label>
            ))}
            <p className="muted small">已勾选 {selectedIds.size} 题</p>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>3 · 排版设置</h3>
        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="练习卷标题" />
        {settings && settings.namingPresets.length > 0 && (
          <div className="chip-row">
            {settings.namingPresets.map((p) => (
              <button key={p} className="chip" onClick={() => setTitle(p)}>{p}</button>
            ))}
          </div>
        )}
        <div className="form-row inline">
          <label>题图宽度</label>
          <input type="range" min={40} max={100} step={5} value={defaultScale * 100}
            onChange={(e) => setDefaultScale(Number(e.target.value) / 100)} />
          <span className="muted small">{Math.round(defaultScale * 100)}%</span>
        </div>
        <div className="form-row inline">
          <label>答题空白</label>
          <input type="number" min={0} max={120} step={5} value={defaultBlankMm}
            onChange={(e) => setDefaultBlankMm(Math.max(0, Number(e.target.value)))} />
          <span className="muted small">mm（0 = 不留空白，题目紧凑排列）</span>
        </div>
        <div className="form-row">
          <label>题目呈现方式（每题可在预览页单独切换）</label>
          <div className="chip-row">
            <button className={`chip${!defaultUseOcrText ? ' active' : ''}`} onClick={() => setDefaultUseOcrText(false)}>🖼️ 使用题目图片</button>
            <button className={`chip${defaultUseOcrText ? ' active' : ''}`} onClick={() => setDefaultUseOcrText(true)}>📝 使用 OCR 题目文字</button>
          </div>
          <p className="muted small">选择文字呈现时，未做过 OCR 识别的题目自动回退为图片</p>
        </div>
        <label className="switch-row">
          <input type="checkbox" checked={includeAnswer} onChange={(e) => setIncludeAnswer(e.target.checked)} />
          导出原始未擦除答案图（R11，默认关闭）
        </label>
        <p className="muted small">每道题可在预览前按卷面单独微调，生成后进入 A4 预览</p>
      </div>

      <button className="btn-primary big" onClick={makePaper} disabled={busy}>
        <Printer size={18} /> {busy ? '生成中…' : `生成练习卷预览`}
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, CircleCheck, CircleX, PartyPopper } from 'lucide-react'
import { questionRepo } from '../db/repo'
import { getTodayQueue, submitReview } from '../services/review'
import { useAppStore } from '../store/appStore'
import { AssetImage } from '../components/AssetImage'
import type { Question } from '../types'

// ===== 复习作答：单题大图 / 显示隐藏答案 / 答对答错 / 进度 / 完成页 =====

type Phase = 'answer' | 'done'

interface Result {
  id: string
  title: string
  result: 'correct' | 'wrong'
  newlyMastered: boolean
}

export function ReviewSession() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, settings } = useAppStore()
  const [queue, setQueue] = useState<Question[]>([])
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set())
  const [current, setCurrent] = useState<Question | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [phase, setPhase] = useState<Phase>('answer')
  const [results, setResults] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user || !settings) return
    const state = location.state as { queueIds?: string[]; freeIds?: string[]; free?: boolean } | null
    const setup = async () => {
      if (state?.freeIds?.length) {
        // 自由复习：直接使用外部传入的题目（不读写每日队列快照，不限数量）
        const questions: Question[] = []
        for (const id of state.freeIds) {
          const q = await questionRepo.get(id)
          if (q && !q.deletedAt) questions.push(q)
        }
        setQueue(questions)
        setAnsweredIds(new Set())
        setCurrent(questions[0] ?? null)
        if (questions.length === 0) setPhase('done')
        return
      }
      const snap = await getTodayQueue(user.id, settings)
      const answered = new Set(snap.answered.map((a) => a.id))
      const pending = snap.questions.filter((q) => !answered.has(q.id))
      setQueue(pending)
      setAnsweredIds(answered)
      setCurrent(pending[0] ?? null)
      if (pending.length === 0) setPhase('done')
    }
    setup()
  }, [user, settings, location.state])

  if (!user || !settings) return null

  async function answer(result: 'correct' | 'wrong') {
    if (!current || busy || !settings) return
    setBusy(true)
    try {
      const { newlyMastered } = await submitReview(current, result, settings)
      setResults((rs) => [...rs, { id: current.id, title: current.title, result, newlyMastered }])
      const nextAnswered = new Set(answeredIds)
      nextAnswered.add(current.id)
      setAnsweredIds(nextAnswered)
      const remainingQueue = queue.filter((q) => q.id !== current.id)
      setQueue(remainingQueue)
      setRevealed(false)
      setCurrent(remainingQueue[0] ?? null)
      if (remainingQueue.length === 0) setPhase('done')
    } finally {
      setBusy(false)
    }
  }

  // ===== 完成页 =====
  if (phase === 'done') {
    const correct = results.filter((r) => r.result === 'correct').length
    const mastered = results.filter((r) => r.newlyMastered).length
    return (
      <div className="session-done">
        <PartyPopper size={44} className="done-icon" />
        <h2>本次复习完成</h2>
        <div className="done-stats">
          <div className="done-stat"><b>{results.length}</b><span>本次数量</span></div>
          <div className="done-stat"><b>{results.length > 0 ? Math.round((correct / results.length) * 100) : 0}%</b><span>正确率</span></div>
          <div className="done-stat"><b className="c-mastered">{mastered}</b><span>新增已掌握</span></div>
        </div>
        {results.length > 0 && (
          <ul className="done-list">
            {results.map((r) => (
              <li key={r.id} className={r.result}>
                <span>{r.result === 'correct' ? '✓' : '✗'}</span> {r.title}
                {r.newlyMastered && <em>新掌握 🎉</em>}
              </li>
            ))}
          </ul>
        )}
        <button className="btn-primary big" onClick={() => navigate('/')}>回到错题本</button>
      </div>
    )
  }

  if (!current) return <div className="page-loading">加载中…</div>

  const idx = results.length + 1
  const total = results.length + queue.length

  return (
    <div className="session-page">
      <div className="session-progress">
        <div className="session-progress-bar"><div style={{ width: `${(idx / total) * 100}%` }} /></div>
        <span className="muted small">第 {idx} 题 / 共 {total} 题</span>
      </div>

      <div className="session-card">
        <div className="session-image">
          <AssetImage assetId={current.mainAssetId} alt={current.title} />
          {current.auxAssetIds?.map((aid) => (
            <AssetImage key={aid} assetId={aid} className="session-aux" alt="附图" />
          ))}
        </div>
        <div className="session-title-row">
          <b>{current.title}</b>
          <button className="btn-ghost" onClick={() => setRevealed((v) => !v)}>
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />} {revealed ? '隐藏答案' : '显示答案'}
          </button>
        </div>
        {current.ocrText && (
          <details className="session-ocr">
            <summary className="muted small">查看题目文字（OCR）</summary>
            <p className="ocr-display">{current.ocrText}</p>
          </details>
        )}
        {revealed && current.originalAssetId && (
          <div className="session-answer">
            <AssetImage assetId={current.originalAssetId} alt="参考答案" />
            <p className="muted small">参考：原始未擦除图（含手写答案）</p>
          </div>
        )}
        {revealed && !current.originalAssetId && (
          <p className="muted small center">此题未保存原始答案图，请自行核对</p>
        )}
      </div>

      <div className="session-actions">
        <button className="answer-btn wrong" disabled={busy} onClick={() => answer('wrong')}>
          <CircleX size={20} /> 答错了
        </button>
        <button className="answer-btn correct" disabled={busy} onClick={() => answer('correct')}>
          <CircleCheck size={20} /> 答对了
        </button>
      </div>
      <p className="muted small center">答对累计 {settings.masteryThreshold} 次自动掌握；答错不清零，明天优先再练</p>
    </div>
  )
}

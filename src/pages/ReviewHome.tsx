import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlayCircle, BookOpenCheck, Trophy, Settings2, ChevronRight, Shuffle } from 'lucide-react'
import { getTodayQueue } from '../services/review'
import { questionRepo } from '../db/repo'
import { useAppStore } from '../store/appStore'
import type { Question } from '../types'

// ===== 复习首页：今日队列 / 自由复习（科目×类型，不设限制）/ 状态入口 / 设置入口 =====

export function ReviewHome() {
  const { user, settings, subjects, vocabs } = useAppStore()
  const [stats, setStats] = useState({ total: 0, answered: 0, remaining: 0 })
  const [learningCount, setLearningCount] = useState(0)
  const [masteredCount, setMasteredCount] = useState(0)
  const [queueIds, setQueueIds] = useState<string[]>([])
  const navigate = useNavigate()

  // 自由复习选择
  const [freeSubjectId, setFreeSubjectId] = useState('')
  const [freeTypeId, setFreeTypeId] = useState<string>('')
  const [freeStatus, setFreeStatus] = useState<'learning' | 'mastered' | 'all'>('learning')
  const [freePool, setFreePool] = useState<Question[]>([])

  useEffect(() => {
    if (!user || !settings) return
    getTodayQueue(user.id, settings).then((q) => {
      setQueueIds(q.questionIds)
      setStats({
        total: q.questionIds.length,
        answered: q.answered.length,
        remaining: q.questionIds.filter((id) => !q.answered.some((a) => a.id === id)).length,
      })
    })
    questionRepo.list(user.id, { status: 'learning' }).then((l) => setLearningCount(l.length))
    questionRepo.list(user.id, { status: 'mastered' }).then((l) => setMasteredCount(l.length))
  }, [user, settings])

  // 自由复习题池
  useEffect(() => {
    if (!user || !freeSubjectId) return
    questionRepo.list(user.id, {
      subjectId: freeSubjectId,
      status: freeStatus,
    }).then((list) => setFreePool(list.filter((q) => !freeTypeId || q.questionTypeId === freeTypeId)))
  }, [user, freeSubjectId, freeTypeId, freeStatus])

  useEffect(() => { if (!freeSubjectId && subjects.length > 0) setFreeSubjectId(subjects[0].id) }, [subjects, freeSubjectId])

  const qtypes = useMemo(() => vocabs.filter((v) => v.kind === 'qtype'), [vocabs])

  /** 随机打乱顺序后进入自由复习 */
  function startFreeReview() {
    const ids = [...freePool]
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
    navigate('/review/session', { state: { freeIds: ids.map((q) => q.id), free: true } })
  }

  if (!user || !settings) return null

  const pct = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0

  return (
    <div className="review-home">
      <div className="review-hero">
        <div className="review-hero-num">{stats.remaining}</div>
        <div className="review-hero-label">题今日待复习</div>
        {stats.total > 0 && (
          <div className="review-progress">
            <div className="review-progress-bar"><div style={{ width: `${pct}%` }} /></div>
            <span className="muted small">已完成 {stats.answered}/{stats.total}（每日上限 {settings.dailyReviewCount} 题）</span>
          </div>
        )}
        <button className="btn-primary big" disabled={stats.remaining === 0} onClick={() => navigate('/review/session', { state: { queueIds } })}>
          <PlayCircle size={18} /> {stats.remaining > 0 ? '开始复习' : '今日已完成'}
        </button>
        {stats.remaining === 0 && stats.total > 0 && (
          <p className="muted small">今天太棒了，明天的题目已排好 ✓</p>
        )}
        {stats.total === 0 && (
          <p className="muted small">今天没有到期的题目，可使用下方「自由复习」随时加练</p>
        )}
      </div>

      {/* 自由复习：不设每日限制，按科目×题目类型随时进入 */}
      <div className="panel free-review-panel">
        <h3><Shuffle size={15} /> 自由复习（不设数量限制）</h3>
        <div className="form-row">
          <label>科目</label>
          <div className="chip-row">
            {subjects.map((s) => (
              <button key={s.id} className={`chip${freeSubjectId === s.id ? ' active' : ''}`}
                style={freeSubjectId === s.id ? { background: s.color, borderColor: s.color } : {}}
                onClick={() => setFreeSubjectId(s.id)}>{s.name}</button>
            ))}
          </div>
        </div>
        {qtypes.length > 0 && (
          <div className="form-row">
            <label>题目类型</label>
            <div className="chip-row">
              <button className={`chip${freeTypeId === '' ? ' active' : ''}`} onClick={() => setFreeTypeId('')}>全部类型</button>
              {qtypes.map((v) => (
                <button key={v.id} className={`chip${freeTypeId === v.id ? ' active' : ''}`} onClick={() => setFreeTypeId(v.id)}>{v.name}</button>
              ))}
            </div>
          </div>
        )}
        <div className="form-row">
          <label>状态</label>
          <div className="chip-row">
            <button className={`chip${freeStatus === 'learning' ? ' active' : ''}`} onClick={() => setFreeStatus('learning')}>待攻克</button>
            <button className={`chip${freeStatus === 'mastered' ? ' active' : ''}`} onClick={() => setFreeStatus('mastered')}>已掌握</button>
            <button className={`chip${freeStatus === 'all' ? ' active' : ''}`} onClick={() => setFreeStatus('all')}>全部</button>
          </div>
        </div>
        <button className="btn-primary" disabled={freePool.length === 0} onClick={startFreeReview}>
          <PlayCircle size={16} /> 开始自由复习（{freePool.length} 题，随机顺序）
        </button>
        {freePool.length === 0 && <p className="muted small">当前筛选下没有题目</p>}
      </div>

      <div className="link-cards">
        <button className="link-card" onClick={() => navigate('/?status=learning')}>
          <BookOpenCheck size={20} />
          <div><b>待攻克</b><span>{learningCount} 题</span></div>
          <ChevronRight size={16} />
        </button>
        <button className="link-card" onClick={() => navigate('/?status=mastered')}>
          <Trophy size={20} />
          <div><b>已掌握</b><span>{masteredCount} 题</span></div>
          <ChevronRight size={16} />
        </button>
        <button className="link-card" onClick={() => navigate('/settings')}>
          <Settings2 size={20} />
          <div><b>复习偏好</b><span>每日 {settings.dailyReviewCount} 题 · 答对 {settings.masteryThreshold} 次掌握</span></div>
          <ChevronRight size={16} />
        </button>
      </div>

      <p className="muted small center">
        累计答对 {settings.masteryThreshold} 次自动转为已掌握；答错不清零，次日优先复习
      </p>
    </div>
  )
}

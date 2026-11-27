import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Camera, Search, Trash2, RotateCcw } from 'lucide-react'
import { questionRepo } from '../db/repo'
import { useAppStore } from '../store/appStore'
import { AssetImage } from '../components/AssetImage'
import type { Question } from '../types'

// ===== 错题本首页：统计 / 筛选 / 搜索 / 列表 / 收题入口 =====

type StatusFilter = 'all' | 'learning' | 'mastered'

export function Home() {
  const { user, subjects } = useAppStore()
  const [questions, setQuestions] = useState<Question[]>([])
  const [subjectId, setSubjectId] = useState<string>('')
  const [sp] = useSearchParams()
  const statusParam = sp.get('status') as StatusFilter | null
  const [status, setStatus] = useState<StatusFilter>(statusParam ?? 'all')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => { if (statusParam) setStatus(statusParam) }, [statusParam])

  const load = useCallback(() => {
    if (!user) return
    questionRepo.list(user.id, {
      subjectId: subjectId || undefined,
      status,
      search: search.trim() || undefined,
    }).then(setQuestions)
  }, [user, subjectId, status, search])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => {
    const learning = questions.filter((q) => q.status === 'learning').length
    const mastered = questions.filter((q) => q.status === 'mastered').length
    return { learning, mastered, total: questions.length }
  }, [questions])

  if (!user) return null

  return (
    <div className="home-page">
      <div className="user-strip" style={{ background: user.color }}>
        <span className="user-avatar">{user.name.slice(0, 1)}</span>
        <div>
          <div className="user-strip-name">{user.name} 的错题本</div>
          <div className="user-strip-sub">本地保存 · 数据不会上传</div>
        </div>
      </div>

      <div className="stat-row">
        <button className="stat-card" onClick={() => setStatus('learning')}>
          <b className="c-learning">{stats.learning}</b><span>待攻克</span>
        </button>
        <button className="stat-card" onClick={() => setStatus('mastered')}>
          <b className="c-mastered">{stats.mastered}</b><span>已掌握</span>
        </button>
        <button className="stat-card" onClick={() => setStatus('all')}>
          <b>{stats.total}</b><span>全部</span>
        </button>
      </div>

      <div className="chip-row">
        <button className={`chip${subjectId === '' ? ' active' : ''}`} onClick={() => setSubjectId('')}>全部学科</button>
        {subjects.map((s) => (
          <button key={s.id} className={`chip${subjectId === s.id ? ' active' : ''}`} onClick={() => setSubjectId(s.id)}>
            {s.name}
          </button>
        ))}
      </div>

      <div className="search-bar">
        <Search size={16} />
        <input placeholder="搜索错题标题" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {questions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">📷</div>
          <p>还没有错题<br />拍一张作业或试卷开始收集吧</p>
          <button className="btn-primary" onClick={() => navigate('/capture')}>
            <Camera size={16} /> 开始收题
          </button>
        </div>
      ) : (
        <div className="q-list">
          {questions.map((q) => (
            <QuestionCard key={q.id} q={q} onClick={() => navigate(`/questions/${q.id}`)} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  )
}

function QuestionCard({ q, onClick, onChanged }: { q: Question; onClick: () => void; onChanged: () => void }) {
  const { subjects, categories } = useAppStore()
  const subject = subjects.find((s) => s.id === q.subjectId)
  const category = categories.find((c) => c.id === q.categoryId)

  return (
    <div className="q-card" onClick={onClick}>
      <AssetImage assetId={q.mainAssetId} className="q-thumb" alt={q.title} />
      <div className="q-info">
        <div className="q-title">{q.title}</div>
        <div className="q-meta">
          {subject && <span className="tag" style={{ background: subject.color }}>{subject.name}</span>}
          {category && <span className="tag tag-soft">{category.name}</span>}
          <span className="q-date">{q.questionDate}</span>
        </div>
        <div className="q-meta">
          <span className={`tag ${q.status === 'mastered' ? 'tag-mastered' : 'tag-learning'}`}>
            {q.status === 'mastered' ? '✓ 已掌握' : '待攻克'}
          </span>
          <span className="q-count">答对 {q.correctCount} 次</span>
        </div>
      </div>
      {q.deletedAt && (
        <DeletedActions q={q} onChanged={onChanged} />
      )}
    </div>
  )
}

function DeletedActions({ q, onChanged }: { q: Question; onChanged: () => void }) {
  return (
    <div className="deleted-actions" onClick={(e) => e.stopPropagation()}>
      <button title="恢复" onClick={async () => { await questionRepo.restore(q.id); onChanged() }}><RotateCcw size={16} /></button>
      <button title="彻底删除" onClick={async () => { if (confirm('彻底删除后不可恢复，确定吗？')) { await questionRepo.hardDelete(q.id); onChanged() } }}><Trash2 size={16} /></button>
    </div>
  )
}

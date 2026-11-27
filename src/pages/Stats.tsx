import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { questionRepo, reviewRepo, paperRepo, today } from '../db/repo'
import { useAppStore } from '../store/appStore'
import type { Paper, Question, Review } from '../types'

// ===== 学习统计：错题收集 / 复习 / 练习 汇总分析 =====
// 图表配色已通过 dataviz 六项检查（收录 #0E9F6E · 复习 #C2703D，配图例与直接数值标签）

const C_COLLECT = '#0E9F6E'
const C_REVIEW = '#C2703D'

interface DayTrend {
  label: string
  collected: number
  reviewed: number
}

export function Stats() {
  const { user, subjects } = useAppStore()
  const [questions, setQuestions] = useState<Question[]>([])
  const [deletedCount, setDeletedCount] = useState(0)
  const [reviews, setReviews] = useState<Review[]>([])
  const [papers, setPapers] = useState<Paper[]>([])

  useEffect(() => {
    if (!user) return
    questionRepo.list(user.id).then(setQuestions)
    questionRepo.list(user.id, { includeDeleted: true })
      .then((all) => setDeletedCount(all.filter((q) => q.deletedAt).length))
    reviewRepo.byUser(user.id).then(setReviews)
    paperRepo.listByUser(user.id).then(setPapers)
  }, [user])

  const stats = useMemo(() => {
    const learning = questions.filter((q) => q.status === 'learning').length
    const mastered = questions.filter((q) => q.status === 'mastered').length
    const t = today()

    // 学科分布
    const bySubject = subjects.map((s) => ({
      id: s.id, name: s.name, color: s.color,
      count: questions.filter((q) => q.subjectId === s.id).length,
    })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count)

    // 错误原因分布
    const { vocabs } = useAppStore.getState()
    const byReason = vocabs.filter((v) => v.kind === 'reason').map((v) => ({
      id: v.id, name: v.name,
      count: questions.filter((q) => q.errorReasonId === v.id).length,
    })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count)

    // 近 7 天趋势
    const trend: DayTrend[] = []
    for (let i = 6; i >= 0; i--) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD')
      trend.push({
        label: dayjs(d).format('MM.DD'),
        collected: questions.filter((q) => (q.createdAt || '').slice(0, 10) === d).length,
        reviewed: reviews.filter((r) => r.reviewedAt.slice(0, 10) === d).length,
      })
    }

    // 复习正确率
    const reviewedToday = reviews.filter((r) => r.reviewedAt.slice(0, 10) === t).length
    const correct = reviews.filter((r) => r.result === 'correct').length
    const weekAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const weekReviews = reviews.filter((r) => r.reviewedAt.slice(0, 10) >= weekAgo)
    const weekCorrect = weekReviews.filter((r) => r.result === 'correct').length

    const paperCount = papers.length
    const paperQuestions = papers.reduce((sum, p) => sum + p.items.length, 0)
    const latestPaper = papers[0]

    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

    return {
      learning, mastered,
      reviewTotal: reviews.length,
      reviewedToday,
      correctRate: pct(correct, reviews.length),
      weekCorrectRate: pct(weekCorrect, weekReviews.length),
      bySubject, byReason, trend,
      maxTrend: Math.max(1, ...trend.map((d) => Math.max(d.collected, d.reviewed))),
      paperCount, paperQuestions, latestPaper,
    }
  }, [questions, reviews, papers, subjects])

  if (!user) return null

  const maxSubject = Math.max(1, ...stats.bySubject.map((x) => x.count))
  const maxReason = Math.max(1, ...stats.byReason.map((x) => x.count))

  return (
    <div className="stats-page">
      {/* 收集总览 */}
      <div className="panel">
        <h3>错题收集</h3>
        <div className="stat-tiles">
          <div className="stat-tile"><b>{questions.length}</b><span>累计错题</span></div>
          <div className="stat-tile"><b className="c-learning">{stats.learning}</b><span>待攻克</span></div>
          <div className="stat-tile"><b className="c-mastered">{stats.mastered}</b><span>已掌握</span></div>
          <div className="stat-tile"><b>{deletedCount}</b><span>回收站</span></div>
        </div>
        {stats.bySubject.length > 0 && (
          <>
            <div className="muted small">学科分布</div>
            <div className="bar-list">
              {stats.bySubject.map((s) => (
                <div className="bar-row" key={s.id} title={`${s.name}：${s.count} 题`}>
                  <span className="bar-label"><span className="bar-dot" style={{ background: s.color }} />{s.name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(s.count / maxSubject) * 100}%`, background: s.color }} /></span>
                  <span className="bar-val">{s.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {stats.byReason.length > 0 && (
          <>
            <div className="muted small">错误原因分布</div>
            <div className="bar-list">
              {stats.byReason.map((r) => (
                <div className="bar-row" key={r.id} title={`${r.name}：${r.count} 题`}>
                  <span className="bar-label">{r.name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.count / maxReason) * 100}%`, background: C_COLLECT }} /></span>
                  <span className="bar-val">{r.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {questions.length === 0 && <p className="muted small">还没有错题数据，去「收题」添加吧</p>}
      </div>

      {/* 复习情况 */}
      <div className="panel">
        <h3>复习情况</h3>
        <div className="stat-tiles">
          <div className="stat-tile"><b>{stats.reviewTotal}</b><span>总复习次数</span></div>
          <div className="stat-tile"><b>{stats.reviewedToday}</b><span>今日已复习</span></div>
          <div className="stat-tile"><b className="c-mastered">{stats.correctRate}%</b><span>总正确率</span></div>
          <div className="stat-tile"><b className="c-mastered">{stats.weekCorrectRate}%</b><span>近7天正确率</span></div>
        </div>
        {reviews.length > 0 && (
          <>
            <div className="legend">
              <span><span className="bar-dot" style={{ background: C_COLLECT }} /> 收录</span>
              <span><span className="bar-dot" style={{ background: C_REVIEW }} /> 复习</span>
            </div>
            <div className="trend-chart">
              {stats.trend.map((d) => (
                <div className="trend-col" key={d.label} title={`${d.label}：收录 ${d.collected} 题 · 复习 ${d.reviewed} 次`}>
                  <span className="trend-val">{d.collected > 0 || d.reviewed > 0 ? `${d.collected}/${d.reviewed}` : ''}</span>
                  <div className="trend-bars">
                    <span className="trend-bar" style={{ height: `${Math.max(3, (d.collected / stats.maxTrend) * 84)}px`, background: C_COLLECT }} />
                    <span className="trend-bar" style={{ height: `${Math.max(3, (d.reviewed / stats.maxTrend) * 84)}px`, background: C_REVIEW }} />
                  </div>
                  <span className="trend-day">{d.label}</span>
                </div>
              ))}
            </div>
            <p className="muted small center">近 7 天「收录 / 复习」数量</p>
          </>
        )}
        {reviews.length === 0 && <p className="muted small">还没有复习记录，去「复习」开始第一轮吧</p>}
      </div>

      {/* 练习情况 */}
      <div className="panel">
        <h3>练习情况</h3>
        <div className="stat-tiles">
          <div className="stat-tile"><b>{stats.paperCount}</b><span>练习卷数</span></div>
          <div className="stat-tile"><b>{stats.paperQuestions}</b><span>累计出题</span></div>
        </div>
        {stats.latestPaper ? (
          <p className="muted small">最近练习卷：{stats.latestPaper.title}（{stats.latestPaper.createdAt.slice(0, 10)}，{stats.latestPaper.items.length} 题）</p>
        ) : (
          <p className="muted small">还没有制作过练习卷</p>
        )}
      </div>
    </div>
  )
}

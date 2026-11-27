import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { questionRepo, reviewRepo, paperRepo, today } from '../db/repo'
import { useAppStore } from '../store/appStore'
import { BarsWithMA, RateLine, Heatmap, AreaTrend } from '../components/charts'
import type { DayPoint } from '../components/charts'
import type { Paper, Question, Review } from '../types'

// ===== 学习统计：三层指标 =====
// 一、概览层（P0）：题库状态聚合（数字卡片+环形图）/ 本周新增（同比上周箭头）/
//     今日待复习 / 掌握率（大号百分比+进度条）/ 学科分布环形图 / 分类 TOP 5 横向条形图
// 二、趋势层（P0-P1）：近 7/30 天复习量（柱+7日移动平均线，同轴）/
//     每日正确率（折线+7日移动平均）/ 复习热力图（GitHub 贡献图风格）/
//     错题录入趋势（按周聚合面积图）/ 连续复习天数（数字+🔥）/
//     平均达成掌握所需复习次数（数字+对比阈值线）
// 三、诊断层（P1-P2）：薄弱学科 / 顽固错题 TOP 10 / 逾期未复习（一键进入复习）/
//     长期沉睡题 / 零复习题 / 已掌握但曾有连错 / 冷题（组卷覆盖度）

const C_MASTERED = '#0E9F6E'
const C_LEARNING = '#C2703D'
const C_SEQ = '#0E9F6E'
const C_COLLECT = '#0E9F6E'
const C_REVIEW = '#C2703D'

interface DayTrend {
  label: string
  collected: number
  reviewed: number
}

/** 环形图：分段间 2px 留白，中心总量，图例在侧 */
function Donut({ segments, size = 128, thickness = 16, centerValue, centerLabel }: {
  segments: { value: number; color: string; name: string }[]
  size?: number
  thickness?: number
  centerValue: string | number
  centerLabel: string
}) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2
  const C = 2 * Math.PI * r
  const gap = total > 1 ? 2 : 0
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel}环形图`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f0" strokeWidth={thickness} />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total > 0 && segments.map((s, i) => {
          const frac = s.value / total
          const len = Math.max(0.5, frac * C - gap)
          const el = (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-acc}
            />
          )
          acc += frac * C
          return el
        })}
      </g>
      <text x="50%" y="47%" textAnchor="middle" fontSize="22" fontWeight="700" fill="#0f5540">{centerValue}</text>
      <text x="50%" y="63%" textAnchor="middle" fontSize="10" fill="#6b7280">{centerLabel}</text>
    </svg>
  )
}

export function Stats() {
  const { user, subjects, categories, settings } = useAppStore()
  const [questions, setQuestions] = useState<Question[]>([])
  const [deletedCount, setDeletedCount] = useState(0)
  const [reviews, setReviews] = useState<Review[]>([])
  const [papers, setPapers] = useState<Paper[]>([])
  const [range, setRange] = useState<7 | 30>(7)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    if (!user) return
    questionRepo.list(user.id).then(setQuestions)
    questionRepo.list(user.id, { includeDeleted: true })
      .then((all) => setDeletedCount(all.filter((q) => q.deletedAt).length))
    reviewRepo.byUser(user.id).then(setReviews)
    paperRepo.listByUser(user.id).then(setPapers)
  }, [user])

  useEffect(() => { load() }, [load])

  /** 诊断动作：把一批题的 nextReviewAt 提前到今天（召回 / 加入复习） */
  async function recall(list: Question[], label: string) {
    if (list.length === 0) return
    const t = today()
    for (const q of list) {
      q.nextReviewAt = t
      q.updatedAt = new Date().toISOString()
      await questionRepo.put(q)
    }
    alert(`已将 ${list.length} 题加入今日复习队列`)
    load()
    void label
  }

  const stats = useMemo(() => {
    const learning = questions.filter((q) => q.status === 'learning').length
    const mastered = questions.filter((q) => q.status === 'mastered').length
    const t = today()
    const day = (iso?: string) => (iso || '').slice(0, 10)

    // ===== 概览层 =====
    const now = dayjs()
    const monday = now.subtract((now.day() + 6) % 7, 'day').format('YYYY-MM-DD')
    const lastMonday = dayjs(monday).subtract(7, 'day').format('YYYY-MM-DD')
    const thisWeekNew = questions.filter((q) => day(q.createdAt) >= monday).length
    const lastWeekNew = questions.filter((q) => day(q.createdAt) >= lastMonday && day(q.createdAt) < monday).length
    const dueToday = questions.filter((q) => q.status === 'learning' && q.nextReviewAt <= t).length
    const masteryRate = questions.length > 0 ? Math.round((mastered / questions.length) * 100) : 0

    const bySubject = subjects.map((s) => ({
      id: s.id, name: s.name, color: s.color,
      count: questions.filter((q) => q.subjectId === s.id).length,
    })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count)

    const byCategory = categories.map((c) => ({
      id: c.id, name: c.name,
      count: questions.filter((q) => q.categoryId === c.id).length,
    })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 5)

    const { vocabs } = useAppStore.getState()
    const byReason = vocabs.filter((v) => v.kind === 'reason').map((v) => ({
      id: v.id, name: v.name,
      count: questions.filter((q) => q.errorReasonId === v.id).length,
    })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count)

    // ===== 趋势层 =====
    // 近 30 天逐日复习记录
    const dayMap = new Map<string, { reviews: number; correct: number }>()
    for (let i = 0; i < 30; i++) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD')
      dayMap.set(d, { reviews: 0, correct: 0 })
    }
    for (const r of reviews) {
      const k = r.reviewedAt.slice(0, 10)
      const rec = dayMap.get(k)
      if (rec) {
        rec.reviews += 1
        if (r.result === 'correct') rec.correct += 1
      }
    }
    const days: { date: string; label: string; reviews: number; correct: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = dayjs().subtract(i, 'day')
      const rec = dayMap.get(d.format('YYYY-MM-DD')) ?? { reviews: 0, correct: 0 }
      days.push({ date: d.format('YYYY-MM-DD'), label: d.format('MM.DD'), ...rec })
    }

    const reviewBars7: DayPoint[] = days.slice(-7).map((d) => ({ label: d.label, value: d.reviews, tip: `${d.label}：复习 ${d.reviews} 次` }))
    const reviewBars30: DayPoint[] = days.map((d) => ({ label: d.label, value: d.reviews, tip: `${d.label}：复习 ${d.reviews} 次` }))
    const ratePoints: DayPoint[] = days
      .filter((d) => d.reviews > 0)
      .map((d) => ({ label: d.label, value: Math.round((d.correct / d.reviews) * 100), tip: `${d.label}：正确 ${d.correct}/${d.reviews}（${Math.round((d.correct / d.reviews) * 100)}%）` }))

    // 复习热力图 counts
    const heatCounts: Record<string, number> = {}
    for (const r of reviews) {
      const k = r.reviewedAt.slice(0, 10)
      heatCounts[k] = (heatCounts[k] ?? 0) + 1
    }

    // 错题录入趋势：questionDate 按周聚合（近 12 周）
    const weekly: DayPoint[] = []
    for (let i = 11; i >= 0; i--) {
      const wStart = dayjs().subtract((dayjs().day() + 6) % 7 + i * 7, 'day')
      const wEnd = wStart.add(6, 'day').format('YYYY-MM-DD')
      const s = wStart.format('YYYY-MM-DD')
      const count = questions.filter((q) => q.questionDate >= s && q.questionDate <= wEnd).length
      weekly.push({ label: wStart.format('MM.DD'), value: count, tip: `${s} 周：录入 ${count} 题` })
    }

    // 连续复习天数（有 review 的连续自然日；今天未复习不打断，从昨天回溯）
    const reviewDates = new Set(reviews.map((r) => r.reviewedAt.slice(0, 10)))
    let streak = 0
    let cursor = dayjs()
    if (!reviewDates.has(cursor.format('YYYY-MM-DD'))) cursor = cursor.subtract(1, 'day')
    while (reviewDates.has(cursor.format('YYYY-MM-DD'))) {
      streak += 1
      cursor = cursor.subtract(1, 'day')
    }

    // 平均达成掌握所需复习次数（mastered 题的 reviewCount 均值）vs 阈值
    const masteredQs = questions.filter((q) => q.status === 'mastered')
    const avgToMaster = masteredQs.length > 0
      ? Math.round((masteredQs.reduce((s, q) => s + q.reviewCount, 0) / masteredQs.length) * 10) / 10
      : 0
    const threshold = settings?.masteryThreshold ?? 3

    // 复习正确率
    const reviewedToday = reviews.filter((r) => r.reviewedAt.slice(0, 10) === t).length
    const correct = reviews.filter((r) => r.result === 'correct').length
    const weekAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    const weekReviews = reviews.filter((r) => r.reviewedAt.slice(0, 10) >= weekAgo)
    const weekCorrect = weekReviews.filter((r) => r.result === 'correct').length

    // ===== 诊断层 =====
    const wrongOf = (q: Question) => Math.max(0, q.reviewCount - q.correctCount)
    const wrongRateOf = (q: Question) => (q.reviewCount > 0 ? wrongOf(q) / q.reviewCount : 0)

    // 薄弱学科：按学科掌握率升序、平均答错次数降序
    const weakSubjects = bySubject.map((s) => {
      const qs = questions.filter((q) => q.subjectId === s.id)
      const mRate = Math.round((qs.filter((q) => q.status === 'mastered').length / qs.length) * 100)
      const avgWrong = Math.round((qs.reduce((sum, q) => sum + wrongOf(q), 0) / qs.length) * 10) / 10
      return { ...s, total: qs.length, mRate, avgWrong }
    }).sort((a, b) => a.mRate - b.mRate || b.avgWrong - a.avgWrong)

    // 顽固错题 TOP 10：reviewCount ≥ 3 且错误率高
    const stubborn = questions
      .filter((q) => q.reviewCount >= 3 && wrongRateOf(q) >= 0.5)
      .sort((a, b) => wrongRateOf(b) - wrongRateOf(a))
      .slice(0, 10)

    // 逾期未复习：nextReviewAt < 今天 且 learning，按逾期天数排序
    const overdue = questions
      .filter((q) => q.status === 'learning' && q.nextReviewAt < t)
      .map((q) => ({ q, days: dayjs(t).diff(dayjs(q.nextReviewAt), 'day') }))
      .sort((a, b) => b.days - a.days)

    // 长期沉睡题：lastReviewedAt 距今 > 30 天
    const sleeping = questions
      .filter((q) => q.lastReviewedAt && dayjs(t).diff(dayjs(day(q.lastReviewedAt)), 'day') > 30)
      .sort((a, b) => (a.lastReviewedAt! < b.lastReviewedAt! ? -1 : 1))

    // 零复习题：reviewCount = 0 且入库 > 7 天
    const neverReviewed = questions
      .filter((q) => q.reviewCount === 0 && dayjs(t).diff(dayjs(day(q.createdAt)), 'day') > 7)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))

    // 已掌握但曾有连错：status=mastered 且存在连续 2 次以上答错
    const reviewsByQ = new Map<string, Review[]>()
    for (const r of reviews) {
      const arr = reviewsByQ.get(r.questionId) ?? []
      arr.push(r)
      reviewsByQ.set(r.questionId, arr)
    }
    const hasConsecutiveWrong = (list: Review[], n = 2): boolean => {
      const sorted = [...list].sort((a, b) => (a.reviewedAt < b.reviewedAt ? -1 : 1))
      let run = 0
      for (const r of sorted) {
        run = r.result === 'wrong' ? run + 1 : 0
        if (run >= n) return true
      }
      return false
    }
    const fakeMastery = questions.filter((q) => q.status === 'mastered' && hasConsecutiveWrong(reviewsByQ.get(q.id) ?? [], 2))

    // 冷题：从未被任何 paper.items 引用
    const usedIds = new Set<string>()
    for (const p of papers) p.items.forEach((it) => usedIds.add(it.questionId))
    const coldQuestions = questions.filter((q) => !usedIds.has(q.id))

    const paperCount = papers.length
    const paperQuestions = papers.reduce((sum, p) => sum + p.items.length, 0)
    const latestPaper = papers[0]
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

    return {
      learning, mastered, dueToday, masteryRate,
      thisWeekNew, lastWeekNew, weekDiff: thisWeekNew - lastWeekNew,
      bySubject, byCategory, byReason,
      reviewBars7, reviewBars30, ratePoints, heatCounts, weekly,
      streak, avgToMaster, threshold,
      reviewTotal: reviews.length,
      reviewedToday,
      correctRate: pct(correct, reviews.length),
      weekCorrectRate: pct(weekCorrect, weekReviews.length),
      weakSubjects, stubborn, overdue, sleeping, neverReviewed, fakeMastery, coldQuestions,
      paperCount, paperQuestions, latestPaper,
      maxTrend: Math.max(1, ...days.slice(-7).map((d) => Math.max(d.reviews, 0))),
    }
  }, [questions, reviews, papers, subjects, categories, settings])

  if (!user) return null

  const maxCategory = Math.max(1, ...stats.byCategory.map((x) => x.count))
  const maxReason = Math.max(1, ...stats.byReason.map((x) => x.count))
  const statusSegments = [
    { value: stats.learning, color: C_LEARNING, name: '待攻克' },
    { value: stats.mastered, color: C_MASTERED, name: '已掌握' },
  ]
  const trendBars = range === 7 ? stats.reviewBars7 : stats.reviewBars30

  return (
    <div className="stats-page">
      {/* ================= 一、概览层（P0） ================= */}
      <div className="panel">
        <h3>概览</h3>

        <div className="stat-tiles">
          <div className="stat-tile"><b>{questions.length}</b><span>题库总量</span></div>
          <div className="stat-tile"><b className="c-learning">{stats.learning}</b><span>待攻克</span></div>
          <div className="stat-tile"><b className="c-mastered">{stats.mastered}</b><span>已掌握</span></div>
          <div className="stat-tile"><b className="c-due">{stats.dueToday}</b><span>今日待复习</span></div>
        </div>

        {/* 掌握率：大号百分比 + 进度条 */}
        <div className="mastery-block">
          <div className="mastery-left">
            <span className="mastery-pct">{stats.masteryRate}<em>%</em></span>
            <span className="muted small">掌握率（已掌握 {stats.mastered} / 总数 {questions.length}）</span>
          </div>
          <div className="mastery-bar"><div style={{ width: `${stats.masteryRate}%` }} /></div>
        </div>

        {/* 本周新增错题 + 同比上周箭头 */}
        <div className="week-strip">
          <span>本周新增错题</span>
          <b>{stats.thisWeekNew}</b>
          {stats.lastWeekNew > 0 || stats.thisWeekNew > 0 ? (
            <span className={`week-arrow ${stats.weekDiff >= 0 ? 'up' : 'down'}`}>
              {stats.weekDiff >= 0 ? '▲' : '▼'} {Math.abs(stats.weekDiff)} 题（上周 {stats.lastWeekNew}）
            </span>
          ) : <span className="muted small">暂无数据</span>}
        </div>

        {/* 环形图：题库状态 + 学科分布 */}
        <div className="donut-row">
          <div className="donut-card">
            <Donut segments={statusSegments} centerValue={questions.length} centerLabel="题库总量" />
            <div className="donut-legend">
              {statusSegments.map((s) => (
                <span key={s.name}>
                  <span className="bar-dot" style={{ background: s.color }} />
                  {s.name} <b>{s.value}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="donut-card">
            {stats.bySubject.length > 0 ? (
              <>
                <Donut
                  segments={stats.bySubject.map((s) => ({ value: s.count, color: s.color, name: s.name }))}
                  centerValue={questions.length}
                  centerLabel="学科题量"
                />
                <div className="donut-legend">
                  {stats.bySubject.slice(0, 4).map((s) => (
                    <span key={s.id}>
                      <span className="bar-dot" style={{ background: s.color }} />
                      {s.name} <b>{s.count}</b>
                    </span>
                  ))}
                  {stats.bySubject.length > 4 && <span className="muted">其他 {stats.bySubject.length - 4} 项</span>}
                </div>
              </>
            ) : (
              <p className="muted small center" style={{ marginTop: 48 }}>暂无学科数据</p>
            )}
          </div>
        </div>

        {/* 分类 TOP 5 */}
        {stats.byCategory.length > 0 && (
          <>
            <div className="muted small">分类 TOP 5</div>
            <div className="bar-list">
              {stats.byCategory.map((c, i) => (
                <div className="bar-row" key={c.id} title={`${c.name}：${c.count} 题`}>
                  <span className="bar-label rank"><em>{i + 1}</em>{c.name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(c.count / maxCategory) * 100}%`, background: C_SEQ }} /></span>
                  <span className="bar-val">{c.count}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 错误原因分布（补充维度） */}
        {stats.byReason.length > 0 && (
          <>
            <div className="muted small">错误原因分布</div>
            <div className="bar-list">
              {stats.byReason.map((r) => (
                <div className="bar-row" key={r.id} title={`${r.name}：${r.count} 题`}>
                  <span className="bar-label">{r.name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.count / maxReason) * 100}%`, background: C_SEQ }} /></span>
                  <span className="bar-val">{r.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {questions.length === 0 && <p className="muted small">还没有错题数据，去「收题」添加吧</p>}
      </div>

      {/* ================= 二、趋势层（P0-P1） ================= */}
      <div className="panel">
        <h3>趋势</h3>

        <div className="stat-tiles">
          <div className="stat-tile"><b>{stats.reviewTotal}</b><span>总复习次数</span></div>
          <div className="stat-tile"><b>{stats.reviewedToday}</b><span>今日已复习</span></div>
          <div className="stat-tile"><b className="c-mastered">{stats.correctRate}%</b><span>总正确率</span></div>
          <div className="stat-tile"><b className="c-mastered">{stats.weekCorrectRate}%</b><span>近7天正确率</span></div>
        </div>

        {/* 近 7/30 天复习量：柱（每日）+ 7日移动平均线 */}
        <div className="range-row">
          <span className="muted small">近 7 / 30 天复习量</span>
          <span className="range-tabs">
            <button className={`range-tab${range === 7 ? ' active' : ''}`} onClick={() => setRange(7)}>7 天</button>
            <button className={`range-tab${range === 30 ? ' active' : ''}`} onClick={() => setRange(30)}>30 天</button>
          </span>
        </div>
        {stats.reviewTotal > 0 ? (
          <>
            <BarsWithMA data={trendBars} />
            <div className="legend">
              <span><span className="bar-dot" style={{ background: C_COLLECT }} /> 每日复习量</span>
              <span><span className="bar-dot" style={{ background: C_REVIEW }} /> 7 日移动平均</span>
            </div>
          </>
        ) : <p className="muted small">还没有复习记录</p>}

        {/* 每日正确率：折线 + 7 日移动平均 */}
        {stats.ratePoints.length >= 2 && (
          <>
            <div className="range-row" style={{ marginTop: 12 }}>
              <span className="muted small">每日正确率（近 30 天，有复习记录的日期）</span>
            </div>
            <RateLine points={stats.ratePoints} />
            <div className="legend">
              <span><span className="bar-dot" style={{ background: C_COLLECT }} /> 每日正确率</span>
              <span><span className="bar-dot" style={{ background: C_REVIEW }} /> 7 日移动平均</span>
            </div>
          </>
        )}

        {/* 复习热力图 */}
        <div className="range-row" style={{ marginTop: 12 }}>
          <span className="muted small">复习热力图（近 15 周）</span>
        </div>
        <Heatmap counts={stats.heatCounts} />

        {/* 连续复习天数 + 平均达成掌握复习次数 */}
        <div className="stat-tiles tiles-2" style={{ marginTop: 12 }}>
          <div className="stat-tile"><b>{stats.streak} 🔥</b><span>连续复习天数</span></div>
          <div className="stat-tile">
            <b>{stats.avgToMaster || '—'}</b>
            <span>平均达成掌握复习次数{masteredThresholdHint(stats.avgToMaster, stats.threshold)}</span>
          </div>
        </div>
        {stats.avgToMaster > 0 && (
          <p className="muted small center">
            当前掌握阈值 {stats.threshold} 次 ·
            {stats.avgToMaster <= stats.threshold
              ? '达到掌握的平均复习次数不高于阈值，掌握质量扎实 ✓'
              : `比阈值多 ${Math.round((stats.avgToMaster - stats.threshold) * 10) / 10} 次，部分题目需多轮复习才能掌握`}
          </p>
        )}

        {/* 错题录入趋势：按周面积图 */}
        <div className="range-row" style={{ marginTop: 12 }}>
          <span className="muted small">错题录入趋势（近 12 周，按 questionDate 周聚合）</span>
        </div>
        <AreaTrend data={stats.weekly} />
      </div>

      {/* ================= 三、诊断层（P1-P2） ================= */}
      <div className="panel">
        <h3>诊断</h3>

        {/* 薄弱学科 */}
        {stats.weakSubjects.length > 0 && (
          <>
            <div className="muted small">薄弱学科（按掌握率升序）</div>
            <div className="bar-list">
              {stats.weakSubjects.map((s, i) => (
                <div className="bar-row" key={s.id} title={`${s.name}：掌握率 ${s.mRate}% · 平均答错 ${s.avgWrong} 次`}>
                  <span className="bar-label rank">{i === 0 && <em className="weak-flag">!</em>}{s.name}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${s.mRate}%`, background: s.mRate < 50 ? C_LEARNING : C_MASTERED }} />
                  </span>
                  <span className="bar-val">{s.mRate}%</span>
                </div>
              ))}
            </div>
            <p className="muted small">条形为各学科掌握率；排首位建议优先补强（平均答错 {stats.weakSubjects[0].avgWrong} 次/题）</p>
          </>
        )}

        {/* 逾期未复习 + 一键进入复习 */}
        {stats.overdue.length > 0 && (
          <div className="diag-block warn">
            <div className="diag-head">
              <b>逾期未复习</b><span className="diag-count">{stats.overdue.length} 题</span>
              <button className="btn-ghost small" onClick={() => navigate('/review/session', { state: { freeIds: stats.overdue.map((o) => o.q.id), free: true } })}>
                一键复习这 {stats.overdue.length} 题
              </button>
            </div>
            <ul className="diag-list">
              {stats.overdue.slice(0, 5).map(({ q, days }) => (
                <li key={q.id} onClick={() => navigate(`/questions/${q.id}`)}>
                  <span className="diag-title">{q.title}</span>
                  <span className="diag-meta bad">已逾期 {days} 天</span>
                </li>
              ))}
            </ul>
            {stats.overdue.length > 5 && <p className="muted small">还有 {stats.overdue.length - 5} 题未列出</p>}
          </div>
        )}

        {/* 顽固错题 TOP 10 */}
        {stats.stubborn.length > 0 && (
          <div className="diag-block">
            <div className="diag-head"><b>顽固错题 TOP 10</b><span className="diag-count">错误率 ≥ 50% 且复习 ≥ 3 次</span></div>
            <ul className="diag-list">
              {stats.stubborn.map((q) => {
                const wrong = q.reviewCount - q.correctCount
                return (
                  <li key={q.id} onClick={() => navigate(`/questions/${q.id}`)}>
                    <span className="diag-title">{q.title}</span>
                    <span className="diag-meta bad">复习 {q.reviewCount} 次 · 错 {wrong} 次</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* 其余诊断项：计数 + 可展开清单 */}
        <div className="diag-tiles">
          <details className="diag-item">
            <summary>长期沉睡题 <b>{stats.sleeping.length}</b></summary>
            <p className="muted small">上次复习距今超过 30 天，建议召回</p>
            {stats.sleeping.length > 0 && (
              <button className="btn-ghost small" onClick={() => recall(stats.sleeping, '沉睡召回')}>🔔 一键召回（加入今日复习）</button>
            )}
            <ul className="diag-list">
              {stats.sleeping.slice(0, 8).map((q) => (
                <li key={q.id} onClick={() => navigate(`/questions/${q.id}`)}>
                  <span className="diag-title">{q.title}</span>
                  <span className="diag-meta">{dayjs(today()).diff(dayjs((q.lastReviewedAt || '').slice(0, 10)), 'day')} 天前</span>
                </li>
              ))}
            </ul>
          </details>
          <details className="diag-item">
            <summary>零复习题 <b>{stats.neverReviewed.length}</b></summary>
            <p className="muted small">入库超过 7 天仍从未复习——「收题不收心」提醒</p>
            {stats.neverReviewed.length > 0 && (
              <button className="btn-ghost small" onClick={() => recall(stats.neverReviewed, '零复习激活')}>🔔 加入今日复习</button>
            )}
            <ul className="diag-list">
              {stats.neverReviewed.slice(0, 8).map((q) => (
                <li key={q.id} onClick={() => navigate(`/questions/${q.id}`)}>
                  <span className="diag-title">{q.title}</span>
                  <span className="diag-meta">{q.questionDate} 收录</span>
                </li>
              ))}
            </ul>
          </details>
          <details className="diag-item">
            <summary>已掌握但曾有连错 <b>{stats.fakeMastery.length}</b></summary>
            <p className="muted small">存在连续 2 次以上答错，「假掌握」风险提示</p>
            <ul className="diag-list">
              {stats.fakeMastery.slice(0, 8).map((q) => (
                <li key={q.id} onClick={() => navigate(`/questions/${q.id}`)}>
                  <span className="diag-title">{q.title}</span>
                  <span className="diag-meta">累计答对 {q.correctCount} 次</span>
                </li>
              ))}
            </ul>
          </details>
          <details className="diag-item">
            <summary>冷题（未进过练习卷）<b>{stats.coldQuestions.length}</b></summary>
            <p className="muted small">从未被任何练习卷引用，组卷覆盖度 {questions.length > 0 ? Math.round(((questions.length - stats.coldQuestions.length) / questions.length) * 100) : 0}%</p>
            {stats.coldQuestions.length > 0 && (
              <button className="btn-ghost small" onClick={() => navigate('/study?tab=papers')}>📄 去组卷覆盖它们</button>
            )}
          </details>
        </div>

        {questions.length === 0 && reviews.length === 0 && papers.length === 0 && (
          <p className="muted small">积累一些错题和复习记录后，这里会给出针对性诊断</p>
        )}
      </div>

      {/* ===== 练习情况 ===== */}
      <div className="panel">
        <h3>练习情况</h3>
        <div className="stat-tiles tiles-2">
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

function masteredThresholdHint(avg: number, threshold: number): string {
  if (!avg) return ''
  return avg <= threshold ? ' ✓' : ''
}

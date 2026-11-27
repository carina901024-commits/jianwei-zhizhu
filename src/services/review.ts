import dayjs from 'dayjs'
import {
  getMeta, putMeta, questionRepo, reviewRepo, queueKey, today, tomorrow, newId,
} from '../db/repo'
import type { ID, QueueSnapshot, Question, UserSettings } from '../types'

// ===== 复习服务：每日队列快照（R2）、掌握流转（R1/R3/R4）=====

/** 取或生成今日队列快照：每日首次进入生成，刷新不无限补题 */
export async function getTodayQueue(userId: ID, settings: UserSettings): Promise<QueueSnapshot & { questions: Question[] }> {
  const key = queueKey(userId, today())
  let snapshot = await getMeta<QueueSnapshot>(key)
  if (!snapshot) {
    const dbQuestions = await questionRepo.list(userId)
    // 候选：待攻克 + 已到期（新题入库即待复习；答错题次日到期）
    const due = dbQuestions.filter((q) => q.status === 'learning' && q.nextReviewAt <= today())
    // 排序：最早到期优先，其次最久未复习
    due.sort((a, b) => {
      if (a.nextReviewAt !== b.nextReviewAt) return a.nextReviewAt < b.nextReviewAt ? -1 : 1
      const la = a.lastReviewedAt ?? ''
      const lb = b.lastReviewedAt ?? ''
      if (la !== lb) return la < lb ? -1 : 1
      return 0
    })
    const picked = due.slice(0, settings.dailyReviewCount)
    snapshot = { questionIds: picked.map((q) => q.id), answered: [], createdAt: new Date().toISOString() }
    await putMeta(key, snapshot)
  }
  const questions: Question[] = []
  for (const id of snapshot.questionIds) {
    const q = await questionRepo.get(id)
    if (q && !q.deletedAt) questions.push(q)
  }
  return { ...snapshot, questions }
}

/** 提交单题复习结果（R1/R3） */
export async function submitReview(
  question: Question,
  result: 'correct' | 'wrong',
  settings: UserSettings,
): Promise<{ question: Question; newlyMastered: boolean }> {
  const now = new Date().toISOString()
  const wasMastered = question.status === 'mastered'
  const before = question.correctCount

  question.reviewCount += 1
  question.lastReviewedAt = now
  question.nextReviewAt = tomorrow()
  let newlyMastered = false

  if (result === 'correct') {
    question.correctCount += 1
    if (question.status === 'learning' && question.correctCount >= settings.masteryThreshold) {
      question.status = 'mastered' // R1：累计答对 N 次自动转已掌握
      newlyMastered = true
    }
  } else {
    // R3：答错不清零，次日优先（nextReviewAt = 明日到期）
    if (question.status === 'mastered') {
      question.status = 'learning' // R4：已掌握重练答错降回待攻克
    }
  }
  question.updatedAt = now
  await questionRepo.put(question)

  await reviewRepo.put({
    id: newId(),
    questionId: question.id,
    userId: question.userId,
    result,
    reviewedAt: now,
    correctCountAfter: question.correctCount,
  })

  // 更新今日队列快照的 answered
  const key = queueKey(question.userId, today())
  const snapshot = await getMeta<QueueSnapshot>(key)
  if (snapshot && snapshot.questionIds.includes(question.id)) {
    if (!snapshot.answered.some((a) => a.id === question.id)) {
      snapshot.answered.push({ id: question.id, result })
      await putMeta(key, snapshot)
    }
  }

  return { question, newlyMastered }
}

/** 复习统计 */
export async function reviewStats(userId: ID, settings: UserSettings): Promise<{
  total: number; answered: number; remaining: number
}> {
  const snap = await getTodayQueue(userId, settings)
  const answered = snap.answered.length
  return { total: snap.questionIds.length, answered, remaining: snap.questions.filter((q) => !snap.answered.some((a) => a.id === q.id)).length }
}

/** 到期日展示 */
export function dueLabel(q: Question): string {
  if (q.nextReviewAt <= today()) return '今日到期'
  return dayjs(q.nextReviewAt).format('M月D日到期')
}

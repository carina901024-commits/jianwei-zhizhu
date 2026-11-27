import dayjs from 'dayjs'
import { getDB, newId } from './db'
import type {
  Asset, Box, Category, Draft, ID, Paper, PaperFilters, Question, QueueSnapshot,
  Review, Subject, User, UserSettings, Vocab, VocabKind,
} from '../types'
import { DEFAULT_DAILY_REVIEW_COUNT, DEFAULT_MASTERY_THRESHOLD } from '../types'

// ===== 仓储层：统一封装各 Store 的读写 =====

// ---------- users ----------
export const userRepo = {
  async all(): Promise<User[]> {
    const db = await getDB()
    return db.getAll('users')
  },
  async get(id: ID): Promise<User | undefined> {
    return (await getDB()).get('users', id)
  },
  async put(u: User): Promise<void> {
    await (await getDB()).put('users', u)
  },
  async delete(id: ID): Promise<void> {
    await (await getDB()).delete('users', id)
  },
}

// ---------- subjects ----------
export const subjectRepo = {
  async all(): Promise<Subject[]> {
    const db = await getDB()
    const list = await db.getAll('subjects')
    return list.sort((a, b) => a.order - b.order)
  },
  async put(s: Subject): Promise<void> {
    await (await getDB()).put('subjects', s)
  },
  async delete(id: ID): Promise<void> {
    await (await getDB()).delete('subjects', id)
  },
}

// ---------- categories ----------
export const categoryRepo = {
  async all(): Promise<Category[]> {
    return (await getDB()).getAll('categories')
  },
  async bySubject(subjectId: ID): Promise<Category[]> {
    return (await getDB()).getAllFromIndex('categories', 'by-subject', subjectId)
  },
  async put(c: Category): Promise<void> {
    await (await getDB()).put('categories', c)
  },
  async delete(id: ID): Promise<void> {
    const db = await getDB()
    // R5：删除分类后题目回到未分类
    const tx = db.transaction('questions', 'readwrite')
    let cursor = await tx.store.index('by-user').openCursor()
    while (cursor) {
      if (cursor.value.categoryId === id) {
        await cursor.update({ ...cursor.value, categoryId: undefined, updatedAt: new Date().toISOString() })
      }
      cursor = await cursor.continue()
    }
    await tx.done
    await db.delete('categories', id)
  },
}

// ---------- vocabs（题目类型 / 错误原因 / 所属年级） ----------
export const vocabRepo = {
  async byKind(kind: VocabKind): Promise<Vocab[]> {
    const list = await (await getDB()).getAllFromIndex('vocabs', 'by-kind', kind)
    return list.sort((a, b) => a.order - b.order)
  },
  async put(v: Vocab): Promise<void> {
    await (await getDB()).put('vocabs', v)
  },
  /** 删除标签并清理题目引用（引用字段回到"未设置"） */
  async delete(id: ID): Promise<void> {
    const db = await getDB()
    const tx = db.transaction('questions', 'readwrite')
    let cursor = await tx.store.openCursor()
    while (cursor) {
      const q = cursor.value
      if (q.gradeId === id || q.questionTypeId === id || q.errorReasonId === id) {
        await cursor.update({
          ...q,
          gradeId: q.gradeId === id ? undefined : q.gradeId,
          questionTypeId: q.questionTypeId === id ? undefined : q.questionTypeId,
          errorReasonId: q.errorReasonId === id ? undefined : q.errorReasonId,
          updatedAt: new Date().toISOString(),
        })
      }
      cursor = await cursor.continue()
    }
    await tx.done
    await db.delete('vocabs', id)
  },
}

// ---------- assets ----------
// 兼容性关键点：部分手机浏览器（iOS Safari / 安卓 WebView）无法直接把 Blob 存入 IndexedDB
//（报 "Error preparing Blob/File data..."），因此入库前统一转 ArrayBuffer，读取时还原 Blob
export const assetRepo = {
  async get(id: ID): Promise<Asset | undefined> {
    const a = await (await getDB()).get('assets', id)
    if (!a) return undefined
    return { ...a, blob: unwrapAssetBlob(a) }
  },
  async put(a: Asset): Promise<void> {
    const blob = a.blob instanceof Blob ? a.blob : new Blob([a.blob as unknown as ArrayBuffer], { type: a.mime })
    // Blob → ArrayBuffer：规避 Safari / WebView 的 Blob 存储限制
    const data = await blob.arrayBuffer()
    await (await getDB()).put('assets', { ...a, blob: data as unknown as Blob })
  },
  async delete(id: ID): Promise<void> {
    await (await getDB()).delete('assets', id)
  },
}

function unwrapAssetBlob(a: Asset): Blob {
  if (a.blob instanceof Blob) return a.blob
  return new Blob([a.blob as unknown as ArrayBuffer], { type: a.mime })
}

// ---------- questions ----------
export interface QuestionFilter {
  subjectId?: ID
  categoryId?: ID
  status?: Question['status'] | 'all'
  search?: string
  includeDeleted?: boolean
}

export const questionRepo = {
  async get(id: ID): Promise<Question | undefined> {
    return (await getDB()).get('questions', id)
  },
  /** 列表查询：按用户 + 筛选条件，日期倒序 */
  async list(userId: ID, filter: QuestionFilter = {}): Promise<Question[]> {
    const db = await getDB()
    const all = await db.getAllFromIndex('questions', 'by-user', userId)
    let list = all.filter((q) => {
      if (!filter.includeDeleted && q.deletedAt) return false
      if (filter.subjectId && q.subjectId !== filter.subjectId) return false
      if (filter.categoryId && q.categoryId !== filter.categoryId) return false
      if (filter.status && filter.status !== 'all' && q.status !== filter.status) return false
      if (filter.search && !q.title.includes(filter.search)) return false
      return true
    })
    list = list.sort((a, b) => (a.questionDate < b.questionDate ? 1 : a.questionDate > b.questionDate ? -1 : a.createdAt < b.createdAt ? 1 : -1))
    return list
  },
  /** 练习卷筛选：学科 / 分类 / 日期闭区间 / 状态 */
  async forPaper(userId: ID, f: PaperFilters): Promise<Question[]> {
    const db = await getDB()
    const all = await db.getAllFromIndex('questions', 'by-user', userId)
    return all.filter((q) => {
      if (q.deletedAt) return false
      if (f.subjectId && q.subjectId !== f.subjectId) return false
      if (f.categoryId && q.categoryId !== f.categoryId) return false
      if (f.status && f.status !== 'all' && q.status !== f.status) return false
      if (f.dateFrom && q.questionDate < f.dateFrom) return false
      if (f.dateTo && q.questionDate > f.dateTo) return false
      return true
    })
  },
  async put(q: Question): Promise<void> {
    await (await getDB()).put('questions', q)
  },
  /** 软删除进回收站 */
  async softDelete(id: ID): Promise<void> {
    const q = await this.get(id)
    if (!q) return
    q.deletedAt = new Date().toISOString()
    q.updatedAt = q.deletedAt
    await this.put(q)
  },
  async restore(id: ID): Promise<void> {
    const q = await this.get(id)
    if (!q) return
    q.deletedAt = undefined
    q.updatedAt = new Date().toISOString()
    await this.put(q)
  },
  /** 彻底删除：删除题目 + 关联复习记录 + 孤立资产（历史练习卷用快照资产，不受影响） */
  async hardDelete(id: ID): Promise<void> {
    const db = await getDB()
    const q = await db.get('questions', id)
    if (!q) return
    const reviews = await db.getAllFromIndex('reviews', 'by-question', id)
    const assetIds = [q.mainAssetId, q.originalAssetId, ...(q.auxAssetIds || [])].filter(Boolean) as ID[]
    // 只删除未被其他题目 / 草稿 / 练习卷引用的资产
    const [allQuestions, allPapers, allDrafts] = await Promise.all([
      db.getAll('questions'), db.getAll('papers'), db.getAll('drafts'),
    ])
    const usedAssets = new Set<ID>()
    for (const oq of allQuestions) {
      if (oq.id === id) continue
      ;[oq.mainAssetId, oq.originalAssetId, ...(oq.auxAssetIds || [])].filter(Boolean).forEach((a) => usedAssets.add(a as ID))
    }
    for (const p of allPapers) p.items.forEach((it) => { usedAssets.add(it.assetId); if (it.originalAssetId) usedAssets.add(it.originalAssetId) })
    for (const d of allDrafts) usedAssets.add(d.sourceAssetId)
    const tx = db.transaction(['questions', 'reviews', 'assets'], 'readwrite')
    await tx.objectStore('questions').delete(id)
    for (const r of reviews) await tx.objectStore('reviews').delete(r.id)
    for (const a of assetIds) if (!usedAssets.has(a)) await tx.objectStore('assets').delete(a)
    await tx.done
  },
}

// ---------- reviews ----------
export const reviewRepo = {
  async byQuestion(questionId: ID): Promise<Review[]> {
    const list = await (await getDB()).getAllFromIndex('reviews', 'by-question', questionId)
    return list.sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1))
  },
  async put(r: Review): Promise<void> {
    await (await getDB()).put('reviews', r)
  },
}

// ---------- papers ----------
export const paperRepo = {
  async get(id: ID): Promise<Paper | undefined> {
    return (await getDB()).get('papers', id)
  },
  async listByUser(userId: ID): Promise<Paper[]> {
    const list = await (await getDB()).getAllFromIndex('papers', 'by-user', userId)
    return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },
  async put(p: Paper): Promise<void> {
    await (await getDB()).put('papers', p)
  },
  async delete(id: ID): Promise<void> {
    await (await getDB()).delete('papers', id)
  },
}

// ---------- settings ----------
export async function getSettings(userId: ID): Promise<UserSettings> {
  const db = await getDB()
  const s = await db.get('settings', userId)
  if (s) return s
  const def: UserSettings = {
    userId,
    dailyReviewCount: DEFAULT_DAILY_REVIEW_COUNT,
    masteryThreshold: DEFAULT_MASTERY_THRESHOLD,
    namingPresets: [],
  }
  await db.put('settings', def)
  return def
}

export async function saveSettings(s: UserSettings): Promise<void> {
  await (await getDB()).put('settings', s)
}

// ---------- meta（每日队列快照） ----------
export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await (await getDB()).get('meta', key)
  return row?.value as T | undefined
}

export async function putMeta(key: string, value: unknown): Promise<void> {
  await (await getDB()).put('meta', { key, value })
}

export async function deleteMeta(key: string): Promise<void> {
  await (await getDB()).delete('meta', key)
}

export function queueKey(userId: ID, date: string): string {
  return `queue:${userId}:${date}`
}

export type { QueueSnapshot }

// ---------- drafts ----------
export const draftRepo = {
  async listByUser(userId: ID): Promise<Draft[]> {
    const list = await (await getDB()).getAllFromIndex('drafts', 'by-user', userId)
    return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },
  async put(d: Draft): Promise<void> {
    await (await getDB()).put('drafts', d)
  },
  async get(id: ID): Promise<Draft | undefined> {
    return (await getDB()).get('drafts', id)
  },
  async delete(id: ID): Promise<void> {
    await (await getDB()).delete('drafts', id)
  },
}

// ---------- 工具 ----------
export function today(): string {
  return dayjs().format('YYYY-MM-DD')
}

export function tomorrow(): string {
  return dayjs().add(1, 'day').format('YYYY-MM-DD')
}

export function makeBox(): Box {
  return { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
}

export { newId }

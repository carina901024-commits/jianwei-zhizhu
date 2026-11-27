import { getDB, newId } from '../db/db'
import { assetRepo, getSettings } from '../db/repo'
import type { ID } from '../types'

// ===== 数据管理：导出（含 base64 图片的完整备份）/ 导入（按 ID 合并）/ 清空 =====

interface BackupData {
  version: 1
  exportedAt: string
  users: unknown[]
  subjects: unknown[]
  categories: unknown[]
  questions: unknown[]
  reviews: unknown[]
  assets: { id: string; blobBase64: string; width: number; height: number; mime: string; kind: string; createdAt: string }[]
  papers: unknown[]
  settings: unknown[]
  drafts: unknown[]
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** 导出当前用户全部数据为 JSON（含 base64 图片） */
export async function exportUserData(userId: ID): Promise<string> {
  const db = await getDB()
  const settings = await getSettings(userId)

  const allQuestions = await db.getAll('questions')
  const questions = allQuestions.filter((q) => q.userId === userId)
  const questionIds = new Set(questions.map((q) => q.id))

  const allReviews = await db.getAll('reviews')
  const reviews = allReviews.filter((r) => r.userId === userId && questionIds.has(r.questionId))

  const assetIds = new Set<string>()
  for (const q of questions) {
    ;[q.mainAssetId, q.originalAssetId, ...(q.auxAssetIds || [])].filter(Boolean).forEach((a) => assetIds.add(a as string))
  }
  const assets: BackupData['assets'] = []
  const exportAsset = async (id: string) => {
    if (assets.some((x) => x.id === id)) return
    const a = await assetRepo.get(id)
    if (a) {
      assets.push({
        id: a.id,
        blobBase64: await blobToBase64(a.blob),
        width: a.width,
        height: a.height,
        mime: a.mime,
        kind: a.kind,
        createdAt: a.createdAt,
      })
    }
  }
  for (const id of assetIds) {
    await exportAsset(id)
  }

  const papers = (await db.getAll('papers')).filter((p) => p.userId === userId)
  // 练习卷快照资产也要导出
  for (const p of papers) {
    for (const it of p.items) {
      await exportAsset(it.assetId)
      if (it.originalAssetId) await exportAsset(it.originalAssetId)
    }
  }

  const drafts = (await db.getAll('drafts')).filter((d) => d.userId === userId)
  for (const d of drafts) {
    await exportAsset(d.sourceAssetId)
  }

  const data: BackupData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    users: (await db.getAll('users')).filter((u) => u.id === userId),
    subjects: await db.getAll('subjects'),
    categories: (await db.getAll('categories')).filter(Boolean),
    questions,
    reviews,
    assets,
    papers,
    settings: [settings],
    drafts,
  }
  return JSON.stringify(data)
}

/** 导入备份：按 ID 合并（已存在则覆盖），跳过其他用户数据 */
export async function importUserData(json: string, currentUserId: ID): Promise<{ imported: number; skipped: boolean }> {
  const data = JSON.parse(json) as BackupData
  if (!data || data.version !== 1) throw new Error('不支持的备份格式')

  const db = await getDB()
  // 只合并属于当前用户（或无归属）的数据
  const ownerFilter = <T extends { userId?: string }>(list: T[]): T[] =>
    list.filter((x) => !x.userId || x.userId === currentUserId)

  const tx = db.transaction(['users', 'subjects', 'categories', 'questions', 'reviews', 'assets', 'papers', 'settings', 'drafts'], 'readwrite')

  for (const s of data.subjects ?? []) await tx.objectStore('subjects').put(s as never)
  for (const u of data.users ?? []) {
    // 备份里的用户档案统一归并到当前用户，避免档案错乱
    if ('id' in (u as object)) await tx.objectStore('users').put({ ...(u as object), id: currentUserId } as never)
  }
  for (const a of data.assets ?? []) {
    // 入库统一转 ArrayBuffer（规避部分手机浏览器 Blob 存储限制）
    const blob = base64ToBlob(a.blobBase64)
    const data = await blob.arrayBuffer()
    await tx.objectStore('assets').put({
      id: a.id, blob: data, width: a.width, height: a.height, mime: a.mime, kind: a.kind, createdAt: a.createdAt,
    } as never)
  }
  const withOwner = <T extends { userId?: string }>(list: unknown[]): T[] => (list as T[]).filter((x) => !x.userId || x.userId === currentUserId)
  for (const c of withOwner(data.categories ?? [])) await tx.objectStore('categories').put(c as never)
  for (const q of withOwner(data.questions ?? [])) await tx.objectStore('questions').put({ ...q, userId: currentUserId } as never)
  for (const r of withOwner(data.reviews ?? [])) await tx.objectStore('reviews').put({ ...r, userId: currentUserId } as never)
  for (const p of withOwner(data.papers ?? [])) await tx.objectStore('papers').put({ ...p, userId: currentUserId } as never)
  for (const d of withOwner(data.drafts ?? [])) await tx.objectStore('drafts').put({ ...d, userId: currentUserId } as never)
  for (const s of data.settings ?? []) await tx.objectStore('settings').put({ ...(s as object), userId: currentUserId } as never)
  await tx.done

  return { imported: (data.questions ?? []).length, skipped: false }
}

/** 清空当前用户数据（保留学科与用户档案），二次确认由 UI 层实现 */
export async function clearUserData(userId: ID): Promise<void> {
  const db = await getDB()
  const [questions, reviews, papers, drafts] = await Promise.all([
    db.getAll('questions'), db.getAll('reviews'), db.getAll('papers'), db.getAll('drafts'),
  ])
  const assetIds = new Set<string>()
  for (const q of questions.filter((q) => q.userId === userId)) {
    ;[q.mainAssetId, q.originalAssetId, ...(q.auxAssetIds || [])].filter(Boolean).forEach((a) => assetIds.add(a as string))
  }
  for (const p of papers.filter((p) => p.userId === userId)) {
    for (const it of p.items) { assetIds.add(it.assetId); if (it.originalAssetId) assetIds.add(it.originalAssetId) }
  }
  for (const d of drafts.filter((d) => d.userId === userId)) assetIds.add(d.sourceAssetId)

  const tx = db.transaction(['questions', 'reviews', 'papers', 'drafts', 'assets', 'meta'], 'readwrite')
  for (const q of questions.filter((q) => q.userId === userId)) await tx.objectStore('questions').delete(q.id)
  for (const r of reviews.filter((r) => r.userId === userId)) await tx.objectStore('reviews').delete(r.id)
  for (const p of papers.filter((p) => p.userId === userId)) await tx.objectStore('papers').delete(p.id)
  for (const d of drafts.filter((d) => d.userId === userId)) await tx.objectStore('drafts').delete(d.id)
  for (const id of assetIds) await tx.objectStore('assets').delete(id)
  let cursor = await tx.objectStore('meta').openCursor()
  while (cursor) {
    if (String(cursor.key).startsWith(`queue:${userId}:`)) await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
  // 重置偏好
  const { saveSettings } = await import('../db/repo')
  await saveSettings({ userId, dailyReviewCount: 10, masteryThreshold: 3, namingPresets: [] })
}

export { newId }

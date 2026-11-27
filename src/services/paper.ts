import { newId } from '../db/db'
import { assetRepo, questionRepo, paperRepo, today } from '../db/repo'
import { snapshotAsset } from './image'
import type { Asset, ID, Paper, PaperFilters, PaperItem, Question } from '../types'

// ===== 组卷服务：随机不放回抽题、快照固化（R10）=====

export interface BuildOptions {
  userId: ID
  title: string
  filters: PaperFilters
  selectedIds: ID[] // 手动模式直接传入；随机模式传抽取结果
  defaultScale: number
  defaultBlankMm: number
  includeAnswer: boolean
  defaultUseOcrText?: boolean // 题目呈现方式：OCR 文字 / 图片
}

/** 从筛选结果中随机抽题（不放回、不重复），数量自动限制在题库上限内 */
export async function pickRandom(pool: Question[], count: number): Promise<Question[]> {
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, Math.min(count, pool.length))
}

/** 制作练习卷：所有题图复制为快照资产，源题删除不影响历史卷 */
export async function buildPaper(opts: BuildOptions): Promise<Paper> {
  const questions: Question[] = []
  for (const id of opts.selectedIds) {
    const q = await questionRepo.get(id)
    if (q) questions.push(q)
  }
  questions.sort((a, b) => (a.questionDate < b.questionDate ? -1 : 1))

  const items: PaperItem[] = []
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const main = await assetRepo.get(q.mainAssetId)
    if (!main) continue // 主图缺失则跳过
    const snapMain = await snapshotAsset(main, 'processed')
    let snapOriginal: Asset | undefined
    if (opts.includeAnswer && q.originalAssetId) {
      const orig = await assetRepo.get(q.originalAssetId)
      if (orig) snapOriginal = await snapshotAsset(orig, 'original')
    }
    items.push({
      questionId: q.id,
      assetId: snapMain.id,
      originalAssetId: snapOriginal?.id,
      title: q.title,
      order: i,
      scale: opts.defaultScale,
      blankMm: opts.defaultBlankMm,
      includeAnswer: opts.includeAnswer && !!q.originalAssetId,
      ocrText: q.ocrText,
      useOcrText: opts.defaultUseOcrText ?? false,
    })
  }

  const paper: Paper = {
    id: newId(),
    userId: opts.userId,
    title: opts.title,
    createdAt: new Date().toISOString(),
    filters: opts.filters,
    layout: {
      defaultScale: opts.defaultScale,
      defaultBlankMm: opts.defaultBlankMm,
      includeAnswer: opts.includeAnswer,
      defaultUseOcrText: opts.defaultUseOcrText ?? false,
    },
    items,
  }
  await paperRepo.put(paper)
  return paper
}

export function paperDateLabel(p: Paper): string {
  return p.createdAt.slice(0, 10) === today()
    ? '今天'
    : p.createdAt.slice(0, 10)
}

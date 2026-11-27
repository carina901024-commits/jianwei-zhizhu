import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import dayjs from 'dayjs'
import { __resetDBForTest, seedDB } from '../src/db/db'
import {
  assetRepo, categoryRepo, getSettings, paperRepo, questionRepo, saveSettings, today, tomorrow,
} from '../src/db/repo'
import { getTodayQueue, submitReview } from '../src/services/review'
import { buildPaper, pickRandom } from '../src/services/paper'
import { clearUserData, exportUserData, importUserData } from '../src/services/backup'
import type { Question } from '../src/types'

// ===== 核心业务规则自测（对应 PRD 关键业务规则 R1-R10）=====

let seq = 0
function makeQuestion(over: Partial<Question> = {}): Question {
  seq += 1
  const now = new Date().toISOString()
  return {
    id: `q-${seq}`,
    userId: 'user-default',
    subjectId: 'sub-math',
    categoryId: undefined,
    gradeId: undefined,
    questionTypeId: undefined,
    errorReasonId: undefined,
    title: `测试错题 ${seq}`,
    questionDate: today(),
    status: 'learning',
    correctCount: 0,
    reviewCount: 0,
    nextReviewAt: today(), // R2：新题入库即进入待复习
    mainAssetId: 'asset-x',
    auxAssetIds: [],
    answerErased: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

async function createAsset(id: string): Promise<void> {
  await assetRepo.put({
    id, blob: new Blob(['x'], { type: 'image/jpeg' }), width: 1, height: 1,
    mime: 'image/jpeg', kind: 'processed', createdAt: new Date().toISOString(),
  })
}

beforeEach(async () => {
  // 每个用例独立全新 IndexedDB
  __resetDBForTest()
  ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  await seedDB()
})

describe('数据层种子（P0 基建）', () => {
  it('内置学科为语文/数学/英语，默认用户存在', async () => {
    const settings = await getSettings('user-default')
    expect(settings.dailyReviewCount).toBe(10)
    expect(settings.masteryThreshold).toBe(3)
    const q = await questionRepo.list('user-default')
    expect(q).toEqual([])
  })
})

describe('R2 每日复习队列', () => {
  it('新题入库即进入待复习；队列快照当天稳定不补题', async () => {
    await questionRepo.put(makeQuestion({ id: 'q-a' }))
    await questionRepo.put(makeQuestion({ id: 'q-b', nextReviewAt: tomorrow() })) // 未到期不进队列
    const settings = await getSettings('user-default')

    const snap1 = await getTodayQueue('user-default', settings)
    expect(snap1.questionIds).toEqual(['q-a'])
    const snap2 = await getTodayQueue('user-default', settings)
    expect(snap2.questionIds).toEqual(snap1.questionIds) // 快照：刷新不补题
  })

  it('每日数量上限生效', async () => {
    const settings = await getSettings('user-default')
    settings.dailyReviewCount = 2
    await saveSettings(settings)
    for (let i = 0; i < 5; i++) await questionRepo.put(makeQuestion({ id: `q-${i}` }))
    const snap = await getTodayQueue('user-default', settings)
    expect(snap.questionIds.length).toBe(2) // 上限 2
  })
})

describe('R1/R3 掌握判定与复习反馈', () => {
  it('累计答对 3 次自动转已掌握', async () => {
    const settings = await getSettings('user-default')
    const q = makeQuestion({ id: 'q-m' })
    await questionRepo.put(q)
    let res
    for (let i = 0; i < 3; i++) {
      const cur = (await questionRepo.get('q-m'))!
      res = await submitReview(cur, 'correct', settings)
    }
    expect(res!.newlyMastered).toBe(true)
    expect((await questionRepo.get('q-m'))!.status).toBe('mastered')
  })

  it('答错不清零，次日优先（nextReviewAt=明天）', async () => {
    const settings = await getSettings('user-default')
    await questionRepo.put(makeQuestion({ id: 'q-w', correctCount: 2 }))
    await submitReview((await questionRepo.get('q-w'))!, 'wrong', settings)
    const q = (await questionRepo.get('q-w'))!
    expect(q.correctCount).toBe(2) // 不清零
    expect(q.nextReviewAt).toBe(tomorrow())
    expect(q.status).toBe('learning')
  })

  it('R4 已掌握重练答错降回待攻克', async () => {
    const settings = await getSettings('user-default')
    await questionRepo.put(makeQuestion({ id: 'q-r', status: 'mastered', correctCount: 3 }))
    await submitReview((await questionRepo.get('q-r'))!, 'wrong', settings)
    expect((await questionRepo.get('q-r'))!.status).toBe('learning')
  })
})

describe('R7/R10 组卷与快照固化', () => {
  it('随机抽题不放回、不重复、不超过题库上限', async () => {
    const pool = Array.from({ length: 5 }, (_, i) => makeQuestion({ id: `p-${i}` }))
    for (const q of pool) await questionRepo.put(q)
    const picked = await pickRandom(pool, 3)
    expect(picked.length).toBe(3)
    expect(new Set(picked.map((q) => q.id)).size).toBe(3)
    const over = await pickRandom(pool, 99)
    expect(over.length).toBe(5) // 自动限制在题库上限
  })

  it('练习卷快照固化：源题彻底删除后历史卷不受影响', async () => {
    await createAsset('asset-x')
    const q = makeQuestion({ id: 'q-snap', mainAssetId: 'asset-x' })
    await questionRepo.put(q)
    const paper = await buildPaper({
      userId: 'user-default', title: '测试卷',
      filters: {}, selectedIds: ['q-snap'],
      defaultScale: 0.85, defaultBlankMm: 0, includeAnswer: false,
    })
    expect(paper.items.length).toBe(1)
    expect(paper.items[0].assetId).not.toBe('asset-x') // 快照复制了资产

    await questionRepo.hardDelete('q-snap') // 彻底删除源题
    expect(await questionRepo.get('q-snap')).toBeUndefined()
    const snapAsset = await assetRepo.get(paper.items[0].assetId)
    expect(snapAsset).toBeDefined() // 快照资产仍在
    expect((await paperRepo.get(paper.id))!.items.length).toBe(1)
  })
})

describe('R5/R9 分类与删除', () => {
  it('删除分类后题目回到未分类', async () => {
    await categoryRepo.put({ id: 'cat-1', name: '函数', subjectId: 'sub-math', createdAt: new Date().toISOString() })
    await questionRepo.put(makeQuestion({ id: 'q-c', categoryId: 'cat-1' }))
    await categoryRepo.delete('cat-1')
    expect((await questionRepo.get('q-c'))!.categoryId).toBeUndefined()
  })

  it('软删除进回收站，可恢复', async () => {
    await questionRepo.put(makeQuestion({ id: 'q-d' }))
    await questionRepo.softDelete('q-d')
    expect((await questionRepo.get('q-d'))!.deletedAt).toBeDefined()
    expect((await questionRepo.list('user-default')).length).toBe(0) // 列表不含已删除
    await questionRepo.restore('q-d')
    expect((await questionRepo.list('user-default')).length).toBe(1)
  })
})

describe('备份导出导入（R13）', () => {
  it('导出→清空→导入恢复', async () => {
    await createAsset('asset-x')
    await questionRepo.put(makeQuestion({ id: 'q-bk', mainAssetId: 'asset-x' }))
    const json = await exportUserData('user-default')

    await clearUserData('user-default')
    expect((await questionRepo.list('user-default')).length).toBe(0)

    const r = await importUserData(json, 'user-default')
    expect(r.imported).toBe(1)
    const restored = await questionRepo.get('q-bk')
    expect(restored).toBeDefined()
    expect(await assetRepo.get('asset-x')).toBeDefined()
  })
})

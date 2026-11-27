import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  Asset, Category, Draft, Paper, Question, QueueSnapshot, Review, Subject, User, UserSettings, Vocab, VocabKind,
} from '../types'

// ===== IndexedDB：cuotiben，schemaVersion 1 =====

export interface CuotiDB extends DBSchema {
  users: { key: string; value: User }
  subjects: { key: string; value: Subject }
  categories: { key: string; value: Category; indexes: { 'by-subject': string } }
  questions: {
    key: string
    value: Question
    indexes: {
      'by-user': string
      'by-subject': string
      'by-status': string
      'by-date': string
    }
  }
  reviews: { key: string; value: Review; indexes: { 'by-question': string; 'by-user': string } }
  assets: { key: string; value: Asset }
  papers: { key: string; value: Paper; indexes: { 'by-user': string; 'by-created': string } }
  settings: { key: string; value: UserSettings }
  meta: { key: string; value: { key: string; value: unknown } }
  drafts: { key: string; value: Draft; indexes: { 'by-user': string } }
  vocabs: { key: string; value: Vocab; indexes: { 'by-kind': string } }
}

export const BUILTIN_SUBJECTS: Subject[] = [
  { id: 'sub-chinese', name: '语文', color: '#C2703D', builtin: true, order: 1 },
  { id: 'sub-math', name: '数学', color: '#176B52', builtin: true, order: 2 },
  { id: 'sub-english', name: '英语', color: '#3B82F6', builtin: true, order: 3 },
]

export const BUILTIN_VOCABS: Record<VocabKind, string[]> = {
  // 题目类型预设
  qtype: ['选择题', '填空题', '判断题', '计算题', '解答题', '应用题', '作文'],
  // 错误原因预设
  reason: ['计算错误', '概念不清', '审题失误', '粗心大意', '方法不会', '书写不规范'],
  // 年级预设
  grade: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'],
}

let dbPromise: Promise<IDBPDatabase<CuotiDB>> | null = null

export function getDB(): Promise<IDBPDatabase<CuotiDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CuotiDB>('cuotiben', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('users', { keyPath: 'id' })
          db.createObjectStore('subjects', { keyPath: 'id' })

          const catStore = db.createObjectStore('categories', { keyPath: 'id' })
          catStore.createIndex('by-subject', 'subjectId')

          const qStore = db.createObjectStore('questions', { keyPath: 'id' })
          qStore.createIndex('by-user', 'userId')
          qStore.createIndex('by-subject', 'subjectId')
          qStore.createIndex('by-status', 'status')
          qStore.createIndex('by-date', 'questionDate')

          const rStore = db.createObjectStore('reviews', { keyPath: 'id' })
          rStore.createIndex('by-question', 'questionId')
          rStore.createIndex('by-user', 'userId')

          db.createObjectStore('assets', { keyPath: 'id' })

          const pStore = db.createObjectStore('papers', { keyPath: 'id' })
          pStore.createIndex('by-user', 'userId')
          pStore.createIndex('by-created', 'createdAt')

          db.createObjectStore('settings', { keyPath: 'userId' })
          db.createObjectStore('meta', { keyPath: 'key' })

          const dStore = db.createObjectStore('drafts', { keyPath: 'id' })
          dStore.createIndex('by-user', 'userId')
        }
        // v2：标签库（题目类型 / 错误原因 / 所属年级）
        if (oldVersion < 2) {
          const vStore = db.createObjectStore('vocabs', { keyPath: 'id' })
          vStore.createIndex('by-kind', 'kind')
        }
      },
    })
  }
  return dbPromise
}

/** 首次启动种子：内置学科 + 默认用户 + 标签库预设 */
export async function seedDB(): Promise<void> {
  const db = await getDB()
  const subjectCount = await db.count('subjects')
  if (subjectCount === 0) {
    for (const s of BUILTIN_SUBJECTS) await db.put('subjects', s)
  }
  const userCount = await db.count('users')
  if (userCount === 0) {
    await db.put('users', {
      id: 'user-default',
      name: '我',
      color: '#176B52',
      createdAt: new Date().toISOString(),
    })
  }
  // 标签库预设：每个 kind 只在为空时播种（用户可自由增删）
  const kinds: VocabKind[] = ['qtype', 'reason', 'grade']
  for (const kind of kinds) {
    const existing = await db.getAllFromIndex('vocabs', 'by-kind', kind)
    if (existing.length === 0) {
      BUILTIN_VOCABS[kind].forEach((name, i) => {
        void db.put('vocabs', { id: `vocab-${kind}-${i}-${name}`, kind, name, order: i + 1 })
      })
    }
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

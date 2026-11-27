// ===== 领域类型定义（对应 PRD 第 5 章 数据模型）=====

export type ID = string

export interface User {
  id: ID
  name: string
  color: string
  createdAt: string
}

export interface Subject {
  id: ID
  name: string
  color: string
  builtin: boolean
  order: number
}

export interface Category {
  id: ID
  name: string
  subjectId: ID
  createdAt: string
}

export type QuestionStatus = 'learning' | 'mastered'

export interface Question {
  id: ID
  userId: ID
  subjectId: ID
  categoryId?: ID
  gradeId?: ID // 所属年级
  questionTypeId?: ID // 题目类型
  errorReasonId?: ID // 错误原因
  title: string
  questionDate: string // YYYY-MM-DD
  status: QuestionStatus
  correctCount: number // 累计答对次数
  reviewCount: number // 复习总次数
  lastReviewedAt?: string
  nextReviewAt: string // YYYY-MM-DD，到期日
  mainAssetId: ID
  originalAssetId?: ID // 原始未擦除裁剪图，用于对照 / 导出原始答案
  auxAssetIds: ID[] // 附图，最多 3 张
  answerErased: boolean // 是否做过擦除
  ocrText?: string // OCR 识别的题目文字
  note?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string // 软删除
}

export interface Review {
  id: ID
  questionId: ID
  userId: ID
  result: 'correct' | 'wrong'
  reviewedAt: string
  correctCountAfter: number
}

export type AssetKind = 'source' | 'crop' | 'processed' | 'original' | 'thumb' | 'aux'

export interface Asset {
  id: ID
  blob: Blob
  width: number
  height: number
  mime: string
  kind: AssetKind
  createdAt: string
}

export interface PaperItem {
  questionId: ID
  assetId: ID // 快照固化的题图
  originalAssetId?: ID // 快照固化的原始图
  title: string
  order: number
  scale: number // 题图宽度百分比 0.3~1
  blankMm: number // 答题空白 mm
  includeAnswer: boolean // 是否附原始未擦除图
  ocrText?: string // 快照固化的 OCR 题目文字
  useOcrText?: boolean // 呈现方式：true=OCR 文字，false=图片（无文字时回退图片）
}

export interface PaperFilters {
  subjectId?: ID
  categoryId?: ID
  dateFrom?: string
  dateTo?: string
  status?: QuestionStatus | 'all'
}

export interface Paper {
  id: ID
  userId: ID
  title: string
  createdAt: string
  filters: PaperFilters
  layout: { defaultScale: number; defaultBlankMm: number; includeAnswer: boolean; defaultUseOcrText?: boolean }
  items: PaperItem[]
}

export interface UserSettings {
  userId: ID
  dailyReviewCount: number // 每日复习上限，默认 10
  masteryThreshold: number // 掌握阈值，默认 3
  namingPresets: string[] // 常用命名预设
}

// 框选区域，坐标为相对原图的 0~1 归一化值
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

// ===== 标签库：题目类型 / 错误原因 / 所属年级（科目独立存 subjects 表）=====
export type VocabKind = 'qtype' | 'reason' | 'grade'

export interface Vocab {
  id: ID
  kind: VocabKind
  name: string
  order: number
}

export type DraftStatus = 'pending' | 'done'

export interface Draft {
  id: ID
  userId: ID
  sourceAssetId: ID
  box: Box
  subjectId: ID
  categoryId?: ID
  gradeId?: ID
  questionTypeId?: ID
  errorReasonId?: ID
  questionDate: string
  status: DraftStatus
  title: string
  createdAt: string
}

// 每日队列快照，key = queue:{userId}:{date}
export interface QueueSnapshot {
  questionIds: ID[]
  answered: { id: ID; result: 'correct' | 'wrong' }[]
  createdAt: string
}

export const DEFAULT_DAILY_REVIEW_COUNT = 10
export const DEFAULT_MASTERY_THRESHOLD = 3
export const MAX_AUX_IMAGES = 3

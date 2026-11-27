import { useAppStore } from '../store/appStore'
import type { ID, Vocab, VocabKind } from '../types'

// ===== 标签选择行：年级 / 题目类型 / 错误原因（单选，可空）=====

const KIND_LABEL: Record<VocabKind, string> = {
  grade: '年级',
  qtype: '题目类型',
  reason: '错误原因',
}

export function VocabChipRow({ kind, value, onChange }: {
  kind: VocabKind
  value?: ID
  onChange: (v: ID | undefined) => void
}) {
  const vocabs = useAppStore((s) => s.vocabs).filter((v) => v.kind === kind)
  if (vocabs.length === 0) return null
  return (
    <div className="form-row">
      <label>{KIND_LABEL[kind]}（可选）</label>
      <div className="chip-row">
        <button className={`chip${value === undefined ? ' active' : ''}`} onClick={() => onChange(undefined)}>不选</button>
        {vocabs.map((v) => (
          <button key={v.id} className={`chip${value === v.id ? ' active' : ''}`} onClick={() => onChange(v.id)}>
            {v.name}
          </button>
        ))}
      </div>
    </div>
  )
}

export function vocabName(vocabs: Vocab[], id?: ID): string | null {
  if (!id) return null
  return vocabs.find((v) => v.id === id)?.name ?? null
}

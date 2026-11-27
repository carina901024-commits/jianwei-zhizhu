import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Minus, Plus, Trash2, Download, Upload, FileQuestion, UserPlus, ChevronRight,
} from 'lucide-react'
import { clearUserData, exportUserData, importUserData } from '../services/backup'
import { vocabRepo, subjectRepo, questionRepo, newId } from '../db/repo'
import { useAppStore } from '../store/appStore'
import type { Subject, VocabKind } from '../types'

// ===== 设置：用户 / 偏好 / 常用命名 / 标签管理（含学科）/ 数据管理 / 使用指南 =====

export function Settings() {
  const store = useAppStore()
  const { user, users, settings } = store
  const navigate = useNavigate()
  const [newUserName, setNewUserName] = useState('')
  const [presetName, setPresetName] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  if (!user || !settings) return null

  async function doExport() {
    const json = await exportUserData(user!.id)
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cuotiben-backup-${user!.name}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function doImport(file: File | undefined) {
    if (!file) return
    if (!confirm('导入会按 ID 合并数据（同名覆盖），确定继续吗？')) return
    try {
      const json = await file.text()
      const r = await importUserData(json, user!.id)
      alert(`导入完成：合并 ${r.imported} 道题`)
      await store.refresh()
    } catch (e) {
      alert('导入失败：' + (e as Error).message)
    }
  }

  function stepper(value: number, min: number, max: number, onChange: (v: number) => void) {
    return (
      <div className="stepper">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}><Minus size={14} /></button>
        <b>{value}</b>
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}><Plus size={14} /></button>
      </div>
    )
  }

  return (
    <div className="settings-page">
      {/* 当前用户 / 多用户管理 */}
      <div className="panel">
        <h3>用户档案</h3>
        <p className="muted small">本地多用户，无账号；切换用户即切换整套数据</p>
        <div className="user-list">
          {users.map((u) => (
            <div key={u.id} className={`user-row${u.id === user.id ? ' current' : ''}`}>
              <span className="user-avatar" style={{ background: u.color }}>{u.name.slice(0, 1)}</span>
              <b>{u.name}{u.id === user.id && <em>（当前）</em>}</b>
              <button className="btn-ghost small" onClick={() => {
                const name = prompt('修改用户名称', u.name)?.trim()
                if (name && name !== u.name) store.renameUser(u.id, name)
              }}>改名</button>
              {u.id !== user.id && <button className="btn-ghost small" onClick={() => store.switchUser(u.id)}>切换</button>}
              {users.length > 1 && u.id !== user.id && (
                <button className="icon-btn danger" title="删除用户" onClick={async () => {
                  if (!confirm(`删除用户「${u.name}」？该用户的全部数据将被清除且不可恢复。`)) return
                  try { await store.removeUser(u.id) } catch (e) { alert((e as Error).message) }
                }}><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>
        <div className="form-row inline">
          <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="新用户昵称" />
          <button className="btn-ghost" disabled={!newUserName.trim()} onClick={async () => {
            await store.addUser(newUserName); setNewUserName('')
          }}><UserPlus size={15} /> 创建并切换</button>
        </div>
      </div>

      {/* 标签库管理：年级 / 题目类型 / 错误原因 / 学科 */}
      <div className="panel">
        <h3>标签管理</h3>
        <p className="muted small">年级、题目类型、错误原因、学科均可新增、删除；删除后相关题目上的该标签会被移除</p>
        <VocabManager kind="grade" label="所属年级" />
        <SubjectManager />
        <VocabManager kind="qtype" label="题目类型" />
        <VocabManager kind="reason" label="错误原因" />
      </div>

      {/* 复习偏好 */}
      <div className="panel">
        <h3>复习偏好</h3>
        <div className="pref-row">
          <span>每日复习数量上限</span>
          {stepper(settings.dailyReviewCount, 1, 50, (v) => store.updateSettings({ dailyReviewCount: v }))}
        </div>
        <div className="pref-row">
          <span>掌握阈值（累计答对 N 次）</span>
          {stepper(settings.masteryThreshold, 1, 10, (v) => store.updateSettings({ masteryThreshold: v }))}
        </div>
      </div>

      {/* 常用命名 */}
      <div className="panel">
        <h3>常用命名预设</h3>
        <p className="muted small">先作为练习卷标题预设，也可在标题输入时点击复用</p>
        <div className="chip-row">
          {settings.namingPresets.map((p) => (
            <span key={p} className="chip static">{p}
              <button className="chip-del" onClick={() => store.updateSettings({ namingPresets: settings.namingPresets.filter((x) => x !== p) })}>×</button>
            </span>
          ))}
          {settings.namingPresets.length === 0 && <span className="muted small">暂无预设</span>}
        </div>
        <div className="form-row inline">
          <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="如：数学周末练习卷" />
          <button className="btn-ghost" disabled={!presetName.trim()} onClick={() => {
            store.updateSettings({ namingPresets: [...settings.namingPresets, presetName.trim()] })
            setPresetName('')
          }}><Plus size={15} /> 添加</button>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="panel">
        <h3>数据管理</h3>
        <div className="form-row inline">
          <button className="btn-ghost" onClick={doExport}><Download size={15} /> 导出备份（含图片）</button>
          <button className="btn-ghost" onClick={() => importRef.current?.click()}><Upload size={15} /> 导入备份</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <button className="btn-ghost danger" onClick={async () => {
          if (!confirm('即将清空当前用户的全部错题、复习记录与练习卷，此操作不可恢复！确定吗？')) return
          if (!confirm('再次确认：真的要清空吗？建议先导出备份。')) return
          await clearUserData(user.id)
          await store.refresh()
          alert('已清空')
        }}><Trash2 size={15} /> 清空当前用户数据</button>
        <p className="muted small">所有数据保存在本设备浏览器中，建议定期导出备份</p>
      </div>

      <button className="link-card" onClick={() => navigate('/guide')}>
        <FileQuestion size={20} />
        <div><b>使用指南</b><span>收题 / 加工 / 复习 / 组卷 图文说明</span></div>
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

/** 单个标签维度的管理：新增 / 删除 */
function VocabManager({ kind, label }: { kind: VocabKind; label: string }) {
  const { vocabs, refresh } = useAppStore()
  const [name, setName] = useState('')
  const list = vocabs.filter((v) => v.kind === kind)

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (list.some((v) => v.name === trimmed)) { alert('该标签已存在'); return }
    await vocabRepo.put({ id: newId(), kind, name: trimmed, order: list.length + 1 })
    setName('')
    await refresh()
  }

  return (
    <div className="vocab-group">
      <div className="vocab-group-head">{label}</div>
      <div className="chip-row">
        {list.map((v) => (
          <span key={v.id} className="chip static">
            {v.name}
            <button className="chip-del" title={`删除「${v.name}」`} onClick={async () => {
              if (!confirm(`删除${label}「${v.name}」？相关题目上的该标签将被移除。`)) return
              await vocabRepo.delete(v.id)
              await refresh()
            }}>×</button>
          </span>
        ))}
        {list.length === 0 && <span className="muted small">暂无，可在下方添加</span>}
      </div>
      <div className="form-row inline">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={`新增${label}`}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        <button className="btn-ghost" disabled={!name.trim()} onClick={add}><Plus size={15} /> 添加</button>
      </div>
    </div>
  )
}

/** 学科管理：交互同标签（芯片上 × 直接删 / 输入添加），删除前检查引用 */
function SubjectManager() {
  const { subjects, categories, refresh, user } = useAppStore()
  const [name, setName] = useState('')
  const COLORS = ['#C2703D', '#176B52', '#3B82F6', '#7C3AED', '#0891B2', '#B45309', '#DB2777']

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (subjects.some((s) => s.name === trimmed)) { alert('该学科已存在'); return }
    await subjectRepo.put({
      id: newId(), name: trimmed, color: COLORS[subjects.length % COLORS.length], builtin: false, order: subjects.length + 1,
    })
    setName('')
    await refresh()
  }

  async function remove(s: Subject) {
    if (!user) return
    // 引用检查：学科下仍有题目或分类时禁止删除
    const qs = await questionRepo.list(user.id, { subjectId: s.id })
    const catCount = categories.filter((c) => c.subjectId === s.id).length
    if (qs.length > 0 || catCount > 0) {
      alert(`无法删除：学科「${s.name}」下还有 ${qs.length} 道题、${catCount} 个分类，请先处理`)
      return
    }
    if (!confirm(`删除学科「${s.name}」？收题页的学科选项将同步更新。`)) return
    await subjectRepo.delete(s.id)
    await refresh()
  }

  return (
    <div className="vocab-group">
      <div className="vocab-group-head">学科（收题时必选）</div>
      <div className="chip-row">
        {subjects.map((s) => (
          <span key={s.id} className="chip static" style={{ borderColor: s.color }}>
            {s.name}
            <button className="chip-del" title={`删除学科「${s.name}」`} onClick={() => remove(s)}>×</button>
          </span>
        ))}
        {subjects.length === 0 && <span className="muted small">暂无学科，请先添加</span>}
      </div>
      <div className="form-row inline">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="新增学科（如：物理）"
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        <button className="btn-ghost" disabled={!name.trim()} onClick={add}><Plus size={15} /> 添加</button>
      </div>
    </div>
  )
}

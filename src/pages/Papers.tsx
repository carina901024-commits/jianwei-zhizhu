import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Printer, Trash2, ChevronRight } from 'lucide-react'
import { paperRepo } from '../db/repo'
import { useAppStore } from '../store/appStore'
import type { Paper } from '../types'

// ===== 练习卷首页：制作练习卷 / 历史练习卷列表 =====

export function Papers() {
  const { user } = useAppStore()
  const [papers, setPapers] = useState<Paper[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) return
    paperRepo.listByUser(user.id).then(setPapers)
  }, [user])

  if (!user) return null

  return (
    <div className="papers-page">
      <button className="papers-new-btn" onClick={() => navigate('/papers/new')}>
        <Plus size={22} />
        <div><b>制作练习卷</b><span>筛选题库 → 随机 / 手动选题 → 排版打印</span></div>
      </button>

      <h3>历史练习卷</h3>
      {papers.length === 0 ? (
        <div className="empty-state small">
          <p>还没有练习卷<br />做好的卷子会永久保存在这里，源题删除也不影响</p>
        </div>
      ) : (
        <div className="paper-list">
          {papers.map((p) => (
            <div key={p.id} className="paper-item" onClick={() => navigate(`/papers/${p.id}/preview`)}>
              <div className="paper-item-main">
                <b>{p.title}</b>
                <span className="muted small">
                  {p.createdAt.slice(0, 10)} · {p.items.length} 题 · {p.layout.includeAnswer ? '含答案' : '不含答案'}
                </span>
              </div>
              <Printer size={16} className="muted" />
              <button className="icon-btn danger" title="删除练习卷" onClick={async (e) => {
                e.stopPropagation()
                if (confirm('确定删除这份练习卷吗？')) { await paperRepo.delete(p.id); setPapers(await paperRepo.listByUser(user.id)) }
              }}><Trash2 size={16} /></button>
              <ChevronRight size={16} className="muted" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

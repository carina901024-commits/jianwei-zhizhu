import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BrainCircuit, FileText } from 'lucide-react'
import { ReviewHome } from './ReviewHome'
import { Papers } from './Papers'

// ===== 复习 + 练习卷 合并 Tab：分段切换 =====

export function Study() {
  const [sp] = useSearchParams()
  const [tab, setTab] = useState<'review' | 'papers'>(sp.get('tab') === 'papers' ? 'papers' : 'review')

  useEffect(() => {
    setTab(sp.get('tab') === 'papers' ? 'papers' : 'review')
  }, [sp])

  return (
    <div className="study-page">
      <div className="seg-tabs">
        <button className={`seg-tab${tab === 'review' ? ' active' : ''}`} onClick={() => setTab('review')}>
          <BrainCircuit size={16} /> 复习
        </button>
        <button className={`seg-tab${tab === 'papers' ? ' active' : ''}`} onClick={() => setTab('papers')}>
          <FileText size={16} /> 练习卷
        </button>
      </div>
      {tab === 'review' ? <ReviewHome /> : <Papers />}
    </div>
  )
}

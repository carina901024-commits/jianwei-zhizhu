import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Printer, ArrowLeft } from 'lucide-react'
import { paperRepo } from '../db/repo'
import { AssetImage } from '../components/AssetImage'
import type { Paper } from '../types'

// ===== 练习卷预览：A4 纵向 / 打印 / 另存 PDF =====
// R14：A4 纵向，左右 10mm，单栏；答题空白按 mm 计

export function PaperPreview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [paper, setPaper] = useState<Paper | null>(null)

  useEffect(() => {
    if (!id) return
    paperRepo.get(id).then((p) => {
      if (!p) { navigate('/papers', { replace: true }); return }
      setPaper(p)
    })
  }, [id, navigate])

  if (!paper) return <div className="page-loading">加载中…</div>

  /** 单题切换呈现方式：图片 / OCR 文字（写回练习卷，持久保留） */
  async function setItemMode(index: number, useText: boolean) {
    if (!paper) return
    const items = paper.items.map((it, i) => (i === index ? { ...it, useOcrText: useText } : it))
    const next = { ...paper, items }
    setPaper(next)
    await paperRepo.put(next)
  }

  return (
    <div className="preview-page">
      <div className="preview-toolbar no-print">
        <button className="btn-ghost" onClick={() => history.back()}><ArrowLeft size={15} /> 返回</button>
        <span className="muted small">历史卷已自动保存（快照固化，源题删除不影响）</span>
        <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> 打印 / 另存 PDF</button>
      </div>

      <div className="a4-sheet">
        <header className="a4-header">
          <h1>{paper.title}</h1>
          <div className="a4-meta">
            <span>姓名：__________</span>
            <span>日期：{paper.createdAt.slice(0, 10)}</span>
            <span>共 {paper.items.length} 题</span>
          </div>
        </header>

        {paper.items.length === 0 && <p className="muted">此卷没有题目</p>}

        {paper.items.map((item, i) => {
          const useText = !!item.useOcrText && !!item.ocrText
          return (
            <section className="a4-question" key={item.questionId + '-' + i}>
              <div className="a4-q-head">
                <b>{i + 1}.</b> <span>{item.title}</span>
              </div>

              {/* 呈现方式切换（仅屏幕可见，不打印） */}
              <div className="a4-mode-toggle no-print">
                <button className={`mode-btn${!useText ? ' active' : ''}`}
                  onClick={() => setItemMode(i, false)}>🖼️ 图片</button>
                <button className={`mode-btn${useText ? ' active' : ''}`}
                  disabled={!item.ocrText}
                  title={item.ocrText ? '使用 OCR 识别的题目文字' : '该题未做过 OCR 识别'}
                  onClick={() => setItemMode(i, true)}>📝 OCR 文字</button>
              </div>

              {useText ? (
                <div className="a4-q-text">{item.ocrText}</div>
              ) : (
                <div className="a4-q-image" style={{ width: `${Math.round(item.scale * 100)}%` }}>
                  <AssetImage assetId={item.assetId} alt={item.title} />
                  {!item.ocrText && item.useOcrText && (
                    <p className="a4-answer-label">该题未做过 OCR 识别，已回退为图片</p>
                  )}
                </div>
              )}

              {item.includeAnswer && item.originalAssetId && (
                <div className="a4-q-image original" style={{ width: `${Math.round(item.scale * 100)}%` }}>
                  <p className="a4-answer-label">原始图（含手写答案）</p>
                  <AssetImage assetId={item.originalAssetId} alt="原始答案" />
                </div>
              )}
              <div className="a4-blank" style={{ height: `${item.blankMm}mm` }} />
            </section>
          )
        })}
      </div>
    </div>
  )
}

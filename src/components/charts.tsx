import dayjs from 'dayjs'
import type { ReactNode } from 'react'

// ===== 统计图表组件（纯 SVG，移动端优先）=====
// 规范：单轴；柱 + 移动平均线同单位共轴；线宽 2px；数据末端 4px 圆角；
// 悬浮提示用 <title>；文字用正文色。

export interface DayPoint {
  label: string
  value: number
  tip?: string
}

/** 柱状（日复习量）+ 7 日移动平均折线 —— 同一单位共轴 */
export function BarsWithMA({ data, height = 130, barColor = '#0E9F6E', lineColor = '#C2703D', maWindow = 7 }: {
  data: DayPoint[]
  height?: number
  barColor?: string
  lineColor?: string
  maWindow?: number
}) {
  const W = 340
  const H = height
  const padL = 4
  const padB = 18
  const padT = 10
  const max = Math.max(1, ...data.map((d) => d.value))
  const slot = (W - padL * 2) / Math.max(1, data.length)
  const chartH = H - padB - padT
  const y = (v: number) => padT + chartH - (v / max) * chartH

  const ma = data.map((_, i) => {
    const start = Math.max(0, i - maWindow + 1)
    const win = data.slice(start, i + 1)
    return win.reduce((s, d) => s + d.value, 0) / win.length
  })
  const path = ma.map((v, i) => {
    const x = padL + slot * i + slot / 2
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y(v).toFixed(1)}`
  }).join(' ')

  const labelEvery = Math.max(1, Math.ceil(data.length / 7))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="复习量趋势">
      <line x1={padL} y1={H - padB} x2={W - padL} y2={H - padB} stroke="#e5e7eb" strokeWidth={1} />
      {data.map((d, i) => {
        const x = padL + slot * i + slot * 0.22
        const bw = Math.max(2, slot * 0.56)
        return (
          <rect
            key={i} x={x} y={y(d.value)} width={bw}
            height={Math.max(1, padT + chartH - y(d.value))}
            rx={2} fill={barColor} opacity={0.85}
          >
            <title>{d.tip ?? `${d.label}：${d.value}`}</title>
          </rect>
        )
      })}
      <path d={path} fill="none" stroke={lineColor} strokeWidth={2} strokeLinecap="round" />
      {data.map((d, i) => (
        i % labelEvery === 0
          ? <text key={`t${i}`} x={padL + slot * i + slot / 2} y={H - 4} fontSize="9" textAnchor="middle" fill="#6b7280">{d.label}</text>
          : null
      ))}
    </svg>
  )
}

/** 每日正确率折线 + 7 日移动平均（0~100% 单轴；无复习日断开） */
export function RateLine({ points, height = 120, color = '#0E9F6E', maColor = '#C2703D', maWindow = 7 }: {
  points: DayPoint[]
  height?: number
  color?: string
  maColor?: string
  maWindow?: number
}) {
  const W = 340
  const H = height
  const padL = 22
  const padR = 8
  const padB = 18
  const padT = 8
  const chartH = H - padB - padT
  const x = (i: number) => padL + ((W - padL - padR) * i) / Math.max(1, points.length - 1)
  const y = (v: number) => padT + chartH - (v / 100) * chartH

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const ma = points.map((_, i) => {
    const start = Math.max(0, i - maWindow + 1)
    const win = points.slice(start, i + 1)
    return win.reduce((s, p) => s + p.value, 0) / win.length
  })
  const maPath = ma.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const labelEvery = Math.max(1, Math.ceil(points.length / 6))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="每日正确率">
      {/* 0% / 50% / 100% 参考线 */}
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#eef2f0" strokeWidth={1} />
          <text x={padL - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill="#9ca3af">{v}</text>
        </g>
      ))}
      {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}
      {points.length > 1 && <path d={maPath} fill="none" stroke={maColor} strokeWidth={2} strokeDasharray="5 3" />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={5} fill="transparent">
            <title>{p.tip ?? `${p.label}：${p.value}%`}</title>
          </circle>
          <circle cx={x(i)} cy={y(p.value)} r={2.5} fill={color} />
        </g>
      ))}
      {points.map((p, i) => (
        i % labelEvery === 0
          ? <text key={`t${i}`} x={x(i)} y={H - 4} fontSize="9" textAnchor="middle" fill="#6b7280">{p.label}</text>
          : null
      ))}
    </svg>
  )
}

/** 日历热力图（GitHub 贡献图风格）：近 N 周按日复习次数，绿色深浅=数量 */
export function Heatmap({ counts, weeks = 15, cell = 12, gap = 3 }: {
  counts: Record<string, number>
  weeks?: number
  cell?: number
  gap?: number
}) {
  const today = dayjs()
  const totalDays = weeks * 7
  const start = today.subtract(totalDays - 1, 'day')
  const startAligned = start.subtract((start.day() + 6) % 7, 'day') // 对齐周一
  const colCount = Math.ceil((today.diff(startAligned, 'day') + 1) / 7)
  const W = 18 + colCount * (cell + gap)
  const H = 7 * (cell + gap) + 4

  const levelColor = (v: number): string => {
    if (!v) return '#eef2f0'
    if (v <= 1) return '#d7eee3'
    if (v <= 3) return '#a9dec7'
    if (v <= 5) return '#6fc4a3'
    if (v <= 8) return '#2f9e79'
    return '#0b6b4f'
  }

  const cols: ReactNode[] = []
  for (let c = 0; c < colCount; c++) {
    const rows: ReactNode[] = []
    for (let r = 0; r < 7; r++) {
      const d = startAligned.add(c * 7 + r, 'day')
      if (d.isAfter(today)) break
      const key = d.format('YYYY-MM-DD')
      const v = counts[key] ?? 0
      rows.push(
        <rect
          key={r} x={18 + c * (cell + gap)} y={r * (cell + gap)}
          width={cell} height={cell} rx={3} fill={levelColor(v)}
        >
          <title>{`${key}：复习 ${v} 次`}</title>
        </rect>,
      )
    }
    cols.push(<g key={c}>{rows}</g>)
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="复习热力图">
      {['一', '三', '五', '日'].map((w, i) => (
        <text key={w} x={0} y={(i === 0 ? 0 : [1, 3, 5, 6][i]) * (cell + gap) + cell - 3} fontSize="9" fill="#9ca3af">{w}</text>
      ))}
      {cols}
    </svg>
  )
}

/** 周聚合面积图（错题录入趋势） */
export function AreaTrend({ data, height = 110, color = '#0E9F6E' }: {
  data: DayPoint[]
  height?: number
  color?: string
}) {
  const W = 340
  const H = height
  const padL = 6
  const padR = 10
  const padB = 18
  const padT = 12
  const max = Math.max(1, ...data.map((d) => d.value))
  const chartH = H - padB - padT
  const x = (i: number) => padL + ((W - padL - padR) * i) / Math.max(1, data.length - 1)
  const y = (v: number) => padT + chartH - (v / max) * chartH

  const line = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${line} L${x(data.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L${x(0).toFixed(1)},${(padT + chartH).toFixed(1)} Z`
  const last = data[data.length - 1]
  const labelEvery = Math.max(1, Math.ceil(data.length / 6))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="错题录入趋势">
      <path d={area} fill={color} opacity={0.14} />
      {data.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth={2} />}
      {data.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={6} fill="transparent"><title>{p.tip ?? `${p.label}：${p.value} 题`}</title></circle>
          <circle cx={x(i)} cy={y(p.value)} r={2.5} fill={color} />
        </g>
      ))}
      {last && <text x={x(data.length - 1)} y={y(last.value) - 6} fontSize="10" fontWeight="600" textAnchor="end" fill="#374151">{last.value} 题</text>}
      {data.map((p, i) => (
        i % labelEvery === 0
          ? <text key={`t${i}`} x={x(i)} y={H - 4} fontSize="9" textAnchor="middle" fill="#6b7280">{p.label}</text>
          : null
      ))}
    </svg>
  )
}

import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { BookOpen, BrainCircuit, FileText, Settings2, ChevronLeft, Camera } from 'lucide-react'
import { useAppStore } from '../store/appStore'

// 响应式布局：
// - 移动端（<900px）：顶栏 + 底部四 Tab
// - PC / iPad（≥900px）：左侧栏导航
const TAB_ITEMS = [
  { to: '/', label: '错题本', icon: BookOpen },
  { to: '/review', label: '复习', icon: BrainCircuit },
  { to: '/papers', label: '练习卷', icon: FileText },
  { to: '/settings', label: '我的', icon: Settings2 },
]

const HIDE_TABS = ['/crop', '/editor', '/review/session']

export function AppLayout() {
  const { user } = useAppStore()
  const location = useLocation()
  const isRootTab = ['/', '/review', '/papers', '/settings', '/guide', '/capture', '/papers/new'].some(
    (p) => location.pathname === p,
  )
  const hideBottom = HIDE_TABS.includes(location.pathname) || location.pathname.includes('/preview')

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="side-brand">📒 见微知著</div>
        <nav>
          {TAB_ITEMS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
              <t.icon size={18} />
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-user" style={{ borderLeftColor: user?.color }}>
          <span className="side-user-name">{user?.name}</span>
          <span className="side-user-label">当前用户</span>
        </div>
      </aside>

      <div className="main-col">
        <header className="top-bar">
          {!isRootTab && (
            <button className="icon-btn" onClick={() => history.back()} aria-label="返回">
              <ChevronLeft size={20} />
            </button>
          )}
          <span className="top-title">
            {titleFor(location.pathname)}
          </span>
          {location.pathname === '/' && (
            <NavLink to="/capture" className="capture-entry">
              <Camera size={16} /> 收题
            </NavLink>
          )}
        </header>

        <main className={`page${hideBottom ? ' full-height' : ''}`}>
          <Outlet />
        </main>

        {!hideBottom && (
          <nav className="bottom-tabs">
            {TAB_ITEMS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}>
                <t.icon size={20} />
                <span>{t.label}</span>
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}

function titleFor(path: string): string {
  const map: [string, string][] = [
    ['/capture', '收题'],
    ['/crop', '框选加工'],
    ['/review/session', '复习作答'],
    ['/papers/new', '制作练习卷'],
    ['/guide', '使用指南'],
  ]
  const hit = map.find(([p]) => path.startsWith(p))
  if (hit) return hit[1]
  if (path.startsWith('/questions/')) return '错题详情'
  if (path.includes('/preview')) return '练习卷预览'
  return '见微知著 · 智能错题本'
}

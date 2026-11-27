import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAppStore } from './store/appStore'
import { AppLayout } from './components/AppLayout'
import { Home } from './pages/Home'
import { Capture } from './pages/Capture'
import { CropEditor } from './pages/CropEditor'
import { QuestionDetail } from './pages/QuestionDetail'
import { Study } from './pages/Study'
import { ReviewSession } from './pages/ReviewSession'
import { PapersNew } from './pages/PapersNew'
import { PaperPreview } from './pages/PaperPreview'
import { Stats } from './pages/Stats'
import { Settings } from './pages/Settings'
import { Guide } from './pages/Guide'

/** 旧 /editor 路由兼容跳转（保留 query 参数） */
function EditorRedirect() {
  const location = useLocation()
  return <Navigate to={`/crop${location.search}`} replace />
}

export default function App() {
  const { ready, bootstrap } = useAppStore()

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  if (!ready) {
    return <div className="boot-screen"><span>📒</span><p>见微知著加载中…</p></div>
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="/crop" element={<CropEditor />} />
        <Route path="/editor" element={<EditorRedirect />} />
        <Route path="/questions/:id" element={<QuestionDetail />} />
        <Route path="/study" element={<Study />} />
        <Route path="/review" element={<Navigate to="/study" replace />} />
        <Route path="/review/session" element={<ReviewSession />} />
        <Route path="/papers" element={<Navigate to="/study?tab=papers" replace />} />
        <Route path="/papers/new" element={<PapersNew />} />
        <Route path="/papers/:id/preview" element={<PaperPreview />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

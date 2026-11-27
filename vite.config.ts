import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 生产构建走 GitHub Pages 项目页路径（仓库 jianwei-zhizhu）；开发服务器保持根路径
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/jianwei-zhizhu/' : '/',
  server: { port: 5173, host: true },
}))

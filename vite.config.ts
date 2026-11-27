import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base 对应 GitHub Pages 项目页路径（仓库 jianwei-zhizhu）
export default defineConfig({
  plugins: [react()],
  base: '/jianwei-zhizhu/',
  server: { port: 5173, host: true },
})

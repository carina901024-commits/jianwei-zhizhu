import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 单文件离线版：构建产物为单个 HTML，可直接 file:// 打开
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist-offline' },
})

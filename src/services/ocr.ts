import Tesseract from 'tesseract.js'

// ===== OCR 服务：tesseract.js 中英双语识别（chi_sim + eng）=====
// 支持：汉字、英文、数字、常用符号/公式字符；几何图形无法 OCR（保留在原图中）
// 首次使用需联网下载语言模型，之后浏览器会缓存

let workerPromise: Promise<Tesseract.Worker> | null = null

async function getWorker(onProgress?: (status: string, progress: number) => void): Promise<Tesseract.Worker> {
  if (workerPromise) return workerPromise
  workerPromise = Tesseract.createWorker(['chi_sim', 'eng'], 1, {
    logger: (m) => {
      if (onProgress) onProgress(m.status, m.progress)
    },
  })
  return workerPromise
}

/** 识别图片中的中文文字，返回去除多余空行的文本 */
export async function ocrRecognize(
  image: HTMLCanvasElement | Blob | string,
  onProgress?: (status: string, progress: number) => void,
): Promise<string> {
  const worker = await getWorker(onProgress)
  const { data } = await worker.recognize(image)
  return data.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
}

export function ocrStatusLabel(status: string, progress: number): string {
  if (status.startsWith('recognizing')) return `识别中 ${Math.round(progress * 100)}%`
  if (status.includes('loading')) return `加载模型 ${Math.round(progress * 100)}%`
  if (status.includes('initializ')) return '初始化引擎…'
  return '准备中…'
}

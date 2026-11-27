import { assetRepo } from '../db/repo'
import { newId } from '../db/db'
import type { Asset, AssetKind, Box, ID } from '../types'

// ===== 图片服务：EXIF 方向处理、压缩、裁剪、橡皮擦除合成、缩略图 =====
// 图片 Blob 独立存 assets 表，题目只引用 assetId

const MAX_SIDE = 2000 // 原图最长边上限
const THUMB_SIDE = 480 // 缩略图边长
const JPEG_QUALITY = 0.85
const WHITEN_STRENGTH = 0.38 // 纸张变白强度
const MAX_UNDO_STEPS = 30

export interface Stroke {
  size: number // 笔刷直径，相对底图宽度的比例
  points: { x: number; y: number }[] // 归一化坐标
}

export interface EditState {
  rotate: 0 | 90 | 180 | 270
  whiten: boolean
  strokes: Stroke[]
  strokeIndex: number // 撤销指针（strokes 截断到此）
}

export function newEditState(): EditState {
  return { rotate: 0, whiten: false, strokes: [], strokeIndex: 0 }
}

export function pushStroke(state: EditState, s: Stroke): EditState {
  const strokes = state.strokes.slice(0, state.strokeIndex)
  strokes.push(s)
  if (strokes.length > MAX_UNDO_STEPS) strokes.shift()
  return { ...state, strokes, strokeIndex: strokes.length }
}

export function undo(state: EditState): EditState {
  if (state.strokeIndex <= 0) return state
  return { ...state, strokeIndex: state.strokeIndex - 1 }
}

export function redo(state: EditState): EditState {
  if (state.strokeIndex >= state.strokes.length) return state
  return { ...state, strokeIndex: state.strokeIndex + 1 }
}

/** 加载图片（自动处理 EXIF 方向） */
async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' })
}

/** 兼容性图片解码：
 * 优先 createImageBitmap；失败（旧版 Safari / 安卓 WebView 不支持、HEIC 无法解码、大图内存不足）时
 * 回退到 <img> 解码 —— <img> 对 HEIC 和老内核兼容性最好，且现代浏览器同样按 EXIF 方向显示 */
export async function loadDrawable(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await loadBitmap(blob)
  } catch {
    return loadToDrawable(blob)
  }
}

/** 取解码结果的尺寸（ImageBitmap 与 HTMLImageElement 统一处理） */
export function drawableSize(d: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if ('naturalWidth' in d) return { width: d.naturalWidth || d.width, height: d.naturalHeight || d.height }
  return { width: d.width, height: d.height }
}

function bitmapToJpegCanvas(bmp: ImageBitmap, maxSide: number): HTMLCanvasElement {
  let { width, height } = bmp
  const scale = Math.min(1, maxSide / Math.max(width, height))
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, width, height)
  bmp.close()
  return canvas
}

async function canvasToAsset(canvas: HTMLCanvasElement, kind: AssetKind): Promise<Asset> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', JPEG_QUALITY),
  )
  return {
    id: newId(),
    blob,
    width: canvas.width,
    height: canvas.height,
    mime: 'image/jpeg',
    kind,
    createdAt: new Date().toISOString(),
  }
}

/** 相册/拍照的原始文件 → 压缩后的 source 资产（含兼容性回退） */
export async function fileToSourceAsset(file: File): Promise<Asset> {
  const drawable = await loadDrawable(file)
  const { width, height } = drawableSize(drawable)
  if (!width || !height) throw new Error('无法读取图片尺寸')
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器 Canvas 不可用')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height)
  if (drawable instanceof ImageBitmap) drawable.close()
  return canvasToAsset(canvas, 'source')
}

/** 从 asset 的 Blob 加载（兼容性回退） */
export async function assetToBitmap(asset: Asset): Promise<ImageBitmap | HTMLImageElement> {
  return loadDrawable(asset.blob)
}

/** 按归一化框从 source 资产裁出底图（crop 资产） */
export async function cropAsset(source: Asset, box: Box): Promise<Asset> {
  const drawable = await loadDrawable(source.blob)
  const { width: bw, height: bh } = drawableSize(drawable)
  const sx = Math.round(box.x * bw)
  const sy = Math.round(box.y * bh)
  const sw = Math.max(1, Math.round(box.w * bw))
  const sh = Math.max(1, Math.round(box.h * bh))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(drawable, sx, sy, sw, sh, 0, 0, sw, sh)
  if (drawable instanceof ImageBitmap) drawable.close()
  return canvasToAsset(canvas, 'crop')
}

/** 纸张变白：像素级向白色映射（确定性，跨浏览器一致） */
export function whitenImageData(data: ImageData): void {
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = px[i + c]
      px[i + c] = Math.round(v + (255 - v) * WHITEN_STRENGTH)
    }
  }
}

/** 绘制编辑态到画布：底图 → 变白滤镜 → 擦除笔迹 */
function drawEdit(base: HTMLImageElement | ImageBitmap | HTMLCanvasElement, state: EditState): HTMLCanvasElement {
  // 旋转后画布尺寸交换
  const swapped = state.rotate === 90 || state.rotate === 270
  const w = base.width
  const h = base.height
  const canvas = document.createElement('canvas')
  canvas.width = swapped ? h : w
  canvas.height = swapped ? w : h
  const ctx = canvas.getContext('2d')!

  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((state.rotate * Math.PI) / 180)
  ctx.drawImage(base, -w / 2, -h / 2)
  ctx.restore()

  if (state.whiten) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    whitenImageData(data)
    ctx.putImageData(data, 0, 0)
  }

  // 擦除笔迹：destination-out
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of state.strokes.slice(0, state.strokeIndex)) {
    if (stroke.points.length === 0) continue
    ctx.lineWidth = Math.max(2, stroke.size * canvas.width)
    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height)
    for (const p of stroke.points.slice(1)) ctx.lineTo(p.x * canvas.width, p.y * canvas.height)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

async function loadToDrawable(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')) }
    img.src = url
  })
}

/** 合成编辑结果并落库：processed 主图 + thumb 缩略图；旋转/缩放/变白/擦除烘焙进位图 */
export async function bakeEditedAsset(baseAsset: Asset, state: EditState, kind: AssetKind = 'processed'): Promise<Asset> {
  const drawable = await loadDrawable(baseAsset.blob)
  const canvas = drawEdit(drawable, state)
  if (drawable instanceof ImageBitmap) drawable.close()
  return canvasToAsset(canvas, kind)
}

export async function makeThumbAsset(asset: Asset): Promise<Asset> {
  const drawable = await loadDrawable(asset.blob)
  const { width, height } = drawableSize(drawable)
  const scale = Math.min(1, THUMB_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height)
  if (drawable instanceof ImageBitmap) drawable.close()
  return canvasToAsset(canvas, 'thumb')
}

/** 复制一份资产作为练习卷快照（源题删除后历史卷不受影响） */
export async function snapshotAsset(asset: Asset, kind: AssetKind): Promise<Asset> {
  const copy: Asset = { ...asset, id: newId(), kind, createdAt: new Date().toISOString() }
  await assetRepo.put(copy)
  return copy
}

/** objectURL 管理器：统一释放，避免低端设备内存泄漏 */
export function createURLPool() {
  const urls: string[] = []
  return {
    async from(assetId: ID): Promise<string | null> {
      const a = await assetRepo.get(assetId)
      if (!a) return null
      const url = URL.createObjectURL(a.blob)
      urls.push(url)
      return url
    },
    release() {
      for (const u of urls) URL.revokeObjectURL(u)
      urls.length = 0
    },
  }
}

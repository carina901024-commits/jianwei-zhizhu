# 📒 见微知著 · 智能错题本

本地优先的错题生产与复习工作台：**拍照收题 → 框选切题 → 擦除加工 → 每日复习 → 自动掌握 → 组卷打印**。
所有数据保存在设备浏览器的 IndexedDB 中，不依赖云端账号。

对应需求文档：《拾错 · 智能错题本 功能需求说明书 v1.0》（应用现已更名为「见微知著」）。

## ✨ 功能一览

| 模块 | 能力 |
| --- | --- |
| 错题采集 | 拍照 / 相册选图（HEIC 自动转 JPEG）、**单图多题连续框选**（8 向缩放、框内移动、图上删除）、草稿自动留存 |
| 图片加工 | 橡皮擦除答案（笔刷可调）、撤销/重做、原图对照、纸张变白、旋转、保存自动生成缩略图并保留原图 |
| 错题管理 | 学科/状态筛选、标题搜索、日期倒序、详情（笔记/复习历史/附图最多 3 张）、软删除 → 回收站恢复/彻底删除 |
| 错题复习 | 每日队列（到期 + 久未复习优先，快照防刷新补题）、单题重做、**累计答对 N 次自动已掌握**（默认 3，可设）、答错不清零次日优先、已掌握可重练答错降级 |
| 练习卷 | 学科/分类/日期区间/状态筛选、随机不放回抽题、手动勾选、题图宽度%、答题空白 mm、可导出原始未擦除答案、A4 预览打印/另存 PDF、**历史卷快照永久留存** |
| 用户与设置 | 本地多用户档案切换、每日数量/掌握阈值步进器、常用命名预设、学科分类自主管理、导出/导入（含 base64 图片）、清空数据二次确认、使用指南 |

## 🚀 运行

```bash
npm install
npm run dev        # 开发：http://localhost:5173（局域网可访问，手机可连同一 Wi-Fi 体验）
```

## 📦 构建

```bash
npm run build          # 生产构建 → dist/
npm run build:offline  # 单文件离线版 → dist-offline/index.html
npm run preview        # 本地预览生产构建
npm run typecheck      # TypeScript 类型检查
```

构建产物：
- `dist/` — 标准静态站点，可部署到任意静态服务器 / Nginx / GitHub Pages
- `cuotiben-offline.html` — **单文件离线版**，拷到任何设备双击即可用（数据仍存各设备浏览器内）

## 📱 三端适配

- **手机**（390×844 验收视口）：底部四 Tab（错题本 / 复习 / 练习卷 / 我的），顶部安全区适配
- **iPad / PC**（≥900px）：左侧导航栏 + 更宽内容区，触屏与鼠标操作均支持（Pointer Events）
- 支持添加到主屏幕（PWA meta 已配置），深墨绿主题

## 🗄️ 数据与备份

- IndexedDB 库名 `cuotiben`（schemaVersion 1），10 个 Store：users / subjects / categories / questions / reviews / assets / papers / settings / meta / drafts
- 图片以 Blob 独立存 `assets` 表，题目只引用 `assetId`
- **导出**：设置 → 数据管理 → 导出备份（JSON，含 base64 图片，完整可迁移）
- **导入**：按 ID 合并，同名覆盖，可跨设备恢复
- 建议定期导出备份；清除浏览器数据会丢失本地数据

## 🧠 关键业务规则（与 PRD 对应）

- R1 累计答对 N 次（默认 3，可设）自动转已掌握；答错不清零
- R2 新题入库即待复习；每日队列按最早到期/最久未复习排序，上限 dailyCount（默认 10）；当天首次进入生成队列快照，刷新不补题
- R3 答对 correctCount+1；答错/答对 nextReviewAt 均设为次日，答错题优先
- R4 已掌握题默认不进队列，可手动重练；答错降回待攻克
- R7 单图多框独立成题，共享原图；R8 附图最多 3 张，不进练习卷
- R9 软删除进回收站；R10 练习卷保存即快照，源题删除不影响历史卷
- R11 导出原始答案默认关闭；R14 A4 纵向、左右 10mm、单栏、空白按 mm

## 🧱 技术栈

React 18 + TypeScript + Vite 6 · React Router v6 · Zustand · IndexedDB（idb）· dayjs · lucide-react · Canvas 2D

分层：页面/组件 → 领域服务（`src/services`：复习队列、组卷、图片合成、备份）→ 仓储层（`src/db/repo.ts`）→ IndexedDB。

图片编辑采用「底图 + 笔迹列表」模型：撤销/重做操作笔迹；导出按 底图 → 变白滤镜 → 擦除笔迹 顺序合成；手机照片 EXIF 方向已处理。

## 📁 目录结构

```
src/
  main.tsx / App.tsx / theme.css
  types.ts               # 领域类型（对应 PRD 数据模型）
  db/
    db.ts                # IndexedDB schema + 种子数据
    repo.ts              # 仓储层（增删改查、软删除、级联清理）
  services/
    image.ts             # 图片：压缩/EXIF/裁剪/变白/擦除合成/缩略图/快照
    review.ts            # 复习队列快照 + 掌握流转
    paper.ts             # 随机抽题 + 组卷快照固化
    backup.ts            # 导出/导入/清空
  store/appStore.ts      # 全局状态（当前用户/学科/分类/偏好）
  components/            # 布局（响应式三端）、AssetImage、BottomSheet
  pages/                 # 12 个路由页面
```

## ⚠️ 已知边界

- v1 不含 OCR / AI 批改 / 云同步（PRD 明确不做，数据字段已预留）
- 不同浏览器对 IndexedDB 配额不同，大量高清图建议定期导出备份
- 打印排版以 Chromium 内核（Chrome / Edge）为验收基线

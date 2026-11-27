import { create } from 'zustand'
import {
  categoryRepo, getSettings, saveSettings, subjectRepo, userRepo, vocabRepo,
} from '../db/repo'
import { seedDB } from '../db/db'
import type { Category, Subject, User, UserSettings, Vocab } from '../types'

// ===== 全局状态：当前用户、学科、分类、标签库、偏好 =====

interface AppState {
  ready: boolean
  user: User | null
  users: User[]
  subjects: Subject[]
  categories: Category[]
  vocabs: Vocab[]
  settings: UserSettings | null

  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
  switchUser: (id: string) => Promise<void>
  addUser: (name: string) => Promise<void>
  renameUser: (id: string, name: string) => Promise<void>
  removeUser: (id: string) => Promise<void>
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>
}

const LAST_USER_KEY = 'cuotiben:lastUserId'

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  user: null,
  users: [],
  subjects: [],
  categories: [],
  vocabs: [],
  settings: null,

  async bootstrap() {
    await seedDB()
    await get().refresh()
    set({ ready: true })
  },

  async refresh() {
    const [users, subjects, categories, qtypes, reasons, grades] = await Promise.all([
      userRepo.all(), subjectRepo.all(), categoryRepo.all(),
      vocabRepo.byKind('qtype'), vocabRepo.byKind('reason'), vocabRepo.byKind('grade'),
    ])
    const vocabs = [...qtypes, ...reasons, ...grades]
    const lastId = localStorage.getItem(LAST_USER_KEY)
    const user = users.find((u) => u.id === lastId) ?? users[0] ?? null
    const settings = user ? await getSettings(user.id) : null
    set({ users, subjects, categories, vocabs, user, settings })
  },

  async switchUser(id) {
    localStorage.setItem(LAST_USER_KEY, id)
    const user = await userRepo.get(id)
    if (!user) return
    const settings = await getSettings(id)
    set({ user, settings })
  },

  async addUser(name) {
    const colors = ['#176B52', '#C2703D', '#3B82F6', '#7C3AED', '#0891B2', '#B45309']
    const user = {
      id: `user-${Date.now()}`,
      name: name.trim() || '新用户',
      color: colors[Math.floor(Math.random() * colors.length)],
      createdAt: new Date().toISOString(),
    }
    await userRepo.put(user)
    await get().switchUser(user.id)
    set({ users: await userRepo.all() })
  },

  async renameUser(id, name) {
    const user = await userRepo.get(id)
    if (!user) return
    user.name = name.trim() || user.name
    await userRepo.put(user)
    if (get().user?.id === id) set({ user })
    set({ users: await userRepo.all() })
  },

  async removeUser(id) {
    const { users, user } = get()
    // 当前用户禁止删除；最后一个用户不能删除
    if (id === user?.id) throw new Error('不能删除当前登录用户')
    if (users.length <= 1) throw new Error('至少保留一个用户')
    await userRepo.delete(id)
    await get().refresh()
  },

  async updateSettings(patch) {
    const s = get().settings
    if (!s) return
    const next = { ...s, ...patch }
    await saveSettings(next)
    set({ settings: next })
  },
}))

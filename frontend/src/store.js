import { create } from 'zustand'

export const useStore = create((set, get) => ({
  user: typeof window !== 'undefined' ? JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || 'null') : null,
  setUser: (user) => set((state) => ({ user: typeof user === 'function' ? user(state.user) : user })),
  token: typeof window !== 'undefined' ? (sessionStorage.getItem('token') || localStorage.getItem('token')) : null,
  setToken: (token) => set({ token }),
  logout: () => set(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    return { user: null, token: null, conversations: [], activeId: null, messages: {}, leftTab: 'direct', profileOpen: false, unreadCounts: {}, notifications: [] }
  }),
  profileOpen: false,
  setProfileOpen: (open) => set({ profileOpen: open }),
  leftTab: 'direct',
  setLeftTab: (tab) => set({ leftTab: tab }),
  conversations: [],
  setConversations: (conversations) => set((s) => ({ conversations: typeof conversations === 'function' ? conversations(s.conversations) : conversations })),
  activeId: null,
  setActiveId: (id) => set((s) => {
    if (!s.unreadCounts || !s.unreadCounts[id]) return { activeId: id }
    const nextUnread = { ...s.unreadCounts }
    delete nextUnread[id]
    return { activeId: id, unreadCounts: nextUnread }
  }),
  messages: {}, // convId -> list
  setMessages: (convId, list) => set((s) => ({ messages: { ...s.messages, [convId]: list } })),
  pushMessage: (convId, msg) => set((s) => {
    const list = s.messages[convId] || []
    if (list.some(m => m._id === msg._id || (m.tempId && m.tempId === msg.tempId))) return s
    return { messages: { ...s.messages, [convId]: [...list, msg] } }
  }),
  updateMessage: (convId, messageId, patch) => set((s) => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] || []).map(m => m._id === messageId ? { ...m, ...patch } : m)
    }
  })),
  replaceTempMessage: (convId, tempId, newMsg) => set((s) => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] || []).map(m => (m.tempId && m.tempId === tempId) ? newMsg : m)
    }
  })),
  removeMessage: (convId, messageId) => set((s) => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] || []).filter(m => m._id !== messageId)
    }
  })),
  unreadCounts: {},
  incrementUnread: (convId) => set((s) => ({
    unreadCounts: {
      ...(s.unreadCounts || {}),
      [convId]: ((s.unreadCounts || {})[convId] || 0) + 1,
    },
  })),
  clearUnread: (convId) => set((s) => {
    if (!s.unreadCounts || !s.unreadCounts[convId]) return {};
    const next = { ...s.unreadCounts };
    delete next[convId];
    return { unreadCounts: next };
  }),
  clearAllUnread: () => set(() => ({ unreadCounts: {} })),
  notifications: [],
  pushNotification: (notification) => set((s) => ({
    notifications: [
      { ...notification },
      ...(s.notifications || []),
    ].slice(0, 50),
  })),
  clearNotifications: () => set(() => ({ notifications: [] })),

  // Encryption keys management
  encryptionKeys: {}, // convId -> key string
  setEncryptionKey: (convId, keyString) => set((s) => ({
    encryptionKeys: { ...s.encryptionKeys, [convId]: keyString }
  })),
  getEncryptionKey: (convId) => get().encryptionKeys[convId],
}))

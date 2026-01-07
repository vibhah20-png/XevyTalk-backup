import React, { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useStore } from './store'
import { createSocket } from './socket'
import NewChatModal from './NewChatModal'

import API_URL from './config';

const API = API_URL;

const StatusIcon = ({ m, me, totalMembers }) => {
  const others = totalMembers - 1
  const delivered = (m.deliveredTo || []).map(String).filter(id => id !== String(me)).length >= others
  const seen = (m.seenBy || []).map(String).filter(id => id !== String(me)).length >= others
  return (
    <span className="text-xs text-gray-400 ml-2">
      {seen ? '✓✓ Seen' : delivered ? '✓✓ Delivered' : '✓ Sent'}
    </span>
  )
}

export default function App() {
  const { user, setUser, conversations, setConversations, activeId, setActiveId, messages, setMessages, pushMessage, updateMessage, replaceTempMessage } = useStore()
  const [socket, setSocket] = useState(null)
  const [typingUsers, setTypingUsers] = useState({})
  const [openNew, setOpenNew] = useState(false)

  useEffect(() => {
    (async () => {
      let u = JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || 'null')
      const token = sessionStorage.getItem('token') || localStorage.getItem('token')

      if (u && token) {
        try {
          const r = await fetch(`${API}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include'
          })
          if (r.ok) {
            u = await r.json()
            sessionStorage.setItem('user', JSON.stringify(u))
            sessionStorage.setItem('token', token)
            localStorage.removeItem('user')
            localStorage.removeItem('token')
          }
        } catch (e) {
          console.error('Failed to refresh user', e)
        }
      }

      if (!u) {
        const r = await fetch(`${API}/api/auth/guest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'include'
        })
        u = await r.json()
        sessionStorage.setItem('user', JSON.stringify(u))
      }
      setUser(u)
      const s = createSocket(u._id)
      setSocket(s)
      s.on('message_new', (msg) => {
        const rawConv =
          msg?.conversation?._id ||
          msg?.conversation ||
          msg?.conversationId

        if (!rawConv || String(rawConv) === 'undefined' || String(rawConv) === 'null') {
          console.warn('message_new without valid conversation id, skipping', msg)
          return
        }

        const convId = String(rawConv)
        // Replace optimistic temp message when server ack returns
        if (String(msg.sender?._id || msg.sender) === String(u._id) && msg.tempId) {
          replaceTempMessage(convId, msg.tempId, msg)
        } else {
          pushMessage(convId, msg)
        }
        setConversations(cs => cs.map(c => c._id === convId ? { ...c, lastMessageAt: msg.createdAt } : c))
        if (String(msg.sender?._id || msg.sender) !== String(u._id)) {
          s.emit('message_delivered', { messageId: msg._id })
        }
      })
      s.on('message_update', ({ messageId, deliveredTo, seenBy }) => {
        const convId = Object.keys(messages).find(cid => (messages[cid] || []).some(m => m._id === messageId))
        if (convId) updateMessage(convId, messageId, { deliveredTo, seenBy })
      })
      s.on('typing', ({ conversationId, userId }) => {
        setTypingUsers(t => ({ ...t, [conversationId]: new Set([...(t[conversationId] || []), userId]) }))
      })
      s.on('stop_typing', ({ conversationId, userId }) => {
        setTypingUsers(t => {
          const setUsers = new Set(t[conversationId] || [])
          setUsers.delete(userId)
          return { ...t, [conversationId]: setUsers }
        })
      })

      const res = await fetch(`${API}/api/conversations`, {
        headers: { 'x-user-id': u._id },
        credentials: 'include'
      })
      const cs = await res.json()
      setConversations(cs)
      // join all rooms to keep sidebar updated
      cs.forEach(c => s.emit('join_conversation', c._id))
      if (cs[0]) setActiveId(cs[0]._id)
    })()
  }, [])

  useEffect(() => {
    if (!socket || !activeId) return
    socket.emit('join_conversation', activeId)
      ; (async () => {
        const r = await fetch(`${API}/api/messages/${activeId}`, {
          headers: { 'x-user-id': user._id },
          credentials: 'include'
        })
        const msgs = await r.json()
        setMessages(activeId, msgs)
        socket.emit('message_seen', { conversationId: activeId })
      })()
    return () => socket.emit('leave_conversation', activeId)
  }, [socket, activeId])

  if (!user) return <div className="h-screen grid place-items-center text-gray-600">Loading...</div>

  return (
    <div className="h-screen w-screen p-4">
      <div className="h-full bg-white rounded-3xl shadow-soft grid grid-cols-[300px_1fr_300px] gap-4 overflow-hidden">
        <LeftPanel user={user} conversations={conversations} activeId={activeId} onPick={setActiveId} onNew={() => setOpenNew(true)} />
        <CenterPanel user={user} socket={socket} typingUsers={typingUsers} />
        <RightPanel />
      </div>
      {openNew && <NewChatModal onClose={() => setOpenNew(false)} />}
    </div>
  )
}

function LeftPanel({ user, conversations, activeId, onPick, onNew }) {
  const [activeTab, setActiveTab] = useState('direct')
  const { unreadCounts } = useStore()

  // Sort conversations by most recent message
  const sortedConversations = [...conversations].sort((a, b) =>
    new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
  )

  // Filter by tab
  const filteredConversations = sortedConversations.filter(c =>
    activeTab === 'direct' ? c.type === 'direct' : c.type === 'group'
  )

  // Calculate unread counts per tab
  const directUnread = Object.entries(unreadCounts || {}).reduce((sum, [convId, count]) => {
    const conv = conversations.find(c => c._id === convId)
    return sum + (conv?.type === 'direct' ? count : 0)
  }, 0)

  const groupUnread = Object.entries(unreadCounts || {}).reduce((sum, [convId, count]) => {
    const conv = conversations.find(c => c._id === convId)
    return sum + (conv?.type === 'group' ? count : 0)
  }, 0)

  return (
    <div className="h-full bg-sky-50/40 p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-yellow-400 grid place-items-center font-bold">💬</div>
        <div className="font-semibold flex-1">Chat Bot</div>
        <button onClick={onNew} className="text-sm bg-primary text-white rounded-lg px-2 py-1">New</button>
      </div>
      <div className="mb-2">
        <input className="w-full rounded-xl border-0 bg-white shadow-soft px-3 py-2 text-sm" placeholder="Search" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setActiveTab('direct')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative ${activeTab === 'direct'
            ? 'bg-primary text-white'
            : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
        >
          Direct
          {directUnread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {directUnread > 99 ? '99+' : directUnread}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('group')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative ${activeTab === 'group'
            ? 'bg-primary text-white'
            : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
        >
          Groups
          {groupUnread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {groupUnread > 99 ? '99+' : groupUnread}
            </span>
          )}
        </button>
      </div>

      <div className="space-y-2 overflow-y-auto h-[calc(100%-180px)] pr-2">
        {filteredConversations.map(c => {
          const unreadCount = unreadCounts?.[c._id] || 0
          return (
            <button key={c._id} onClick={() => onPick(c._id)} className={`w-full text-left bg-white rounded-xl px-3 py-2 shadow-soft hover:shadow ${activeId === c._id ? 'ring-2 ring-primary/50' : ''} relative`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden flex-shrink-0">
                  <img src={(c.type === 'direct' ? (c.members.find(m => m._id !== user._id)?.avatar) : undefined) || `https://api.dicebear.com/8.x/identicon/svg?seed=${c.name || 'group'}`} alt="" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{c.type === 'group' ? c.name : (c.members.find(m => m._id !== user._id)?.username || 'Direct')}</div>
                  <div className="text-[11px] text-gray-500">{dayjs(c.lastMessageAt).format('HH:mm')}</div>
                </div>
                {unreadCount > 0 && (
                  <div className="bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CenterPanel({ user, socket, typingUsers }) {
  const { activeId, messages, pushMessage } = useStore()
  const [text, setText] = useState('')
  const listRef = useRef(null)
  const convMessages = messages[activeId] || []

  const titleForActive = () => {
    const conv = useStore.getState().conversations.find(c => c._id === activeId)
    if (!conv) return 'Conversation'
    if (conv.type === 'group') return conv.name || 'Group'
    const other = conv.members?.find(m => String(m._id) !== String(user._id))
    return other?.username || 'Direct Chat'
  }

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [convMessages.length])

  const handleSend = () => {
    if (!text.trim() || !socket || !activeId) return
    const tempId = Math.random().toString(36).slice(2)
    const msg = { _id: tempId, tempId, conversation: activeId, sender: user, content: text, createdAt: new Date().toISOString(), deliveredTo: [], seenBy: [] }
    pushMessage(activeId, msg)
    socket.emit('message_send', { conversationId: activeId, content: text, tempId })
    setText('')
    socket.emit('stop_typing', { conversationId: activeId })
  }

  const membersCount = useStore.getState().conversations.find(c => c._id === activeId)?.members?.length || 1

  const isTyping = (typingUsers[activeId] && [...typingUsers[activeId]].filter(id => id !== user._id).length > 0)

  const onInput = (v) => {
    setText(v)
    if (socket && activeId) {
      if (v) socket.emit('typing', { conversationId: activeId })
      else socket.emit('stop_typing', { conversationId: activeId })
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="h-16 flex items-center justify-between px-5 border-b">
        <div className="font-semibold">{titleForActive()}</div>
        <div className="flex items-center gap-2 text-gray-400">
          <button title="Calls - Coming soon" className="p-2 rounded-lg hover:bg-gray-100" disabled>📞</button>
          <button title="Video - Coming soon" className="p-2 rounded-lg hover:bg-gray-100" disabled>🎥</button>
          <button title="More" className="p-2 rounded-lg hover:bg-gray-100">⋯</button>
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto p-6 space-y-3 bg-sky-50/40">
        {convMessages.map(m => (
          <MessageBubble key={m._id} me={user._id} m={m} totalMembers={membersCount} />
        ))}
        {isTyping && <div className="text-xs text-gray-500">Typing...</div>}
      </div>
      <div className="p-4 border-t bg-white">
        <div className="flex items-center gap-2">
          <input value={text} onChange={(e) => onInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }} className="flex-1 rounded-full border-0 bg-sky-50 px-4 py-3" placeholder="Say something..." />
          <button onClick={handleSend} className="bg-primary text-white px-4 py-3 rounded-full">Send</button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ m, me, totalMembers }) {
  const mine = String(m.sender?._id || m.sender) === String(me)
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] rounded-2xl px-4 py-3 shadow ${mine ? 'bg-primary text-white rounded-br-sm' : 'bg-white rounded-bl-sm'}`}>
        <div className="text-sm whitespace-pre-wrap">{m.content}</div>
        <div className={`text-[10px] mt-1 ${mine ? 'text-white/80' : 'text-gray-500'}`}>
          {dayjs(m.createdAt).format('HH:mm')} {mine && <StatusIcon m={m} me={me} totalMembers={totalMembers} />}
        </div>
      </div>
    </div>
  )
}

function RightPanel() {
  return (
    <div className="h-full bg-sky-50/40 p-4">
      <div className="h-full bg-white rounded-2xl shadow-soft p-4 overflow-y-auto">
        <div className="font-semibold mb-3">Notification</div>
        <div className="space-y-3 text-sm text-gray-600 mb-6">
          <div className="flex items-start gap-3"><div className="w-8 h-8 rounded-full bg-gray-200"></div><div>Welcome! Start a chat from the left panel.</div></div>
          <div className="flex items-start gap-3"><div className="w-8 h-8 rounded-full bg-gray-200"></div><div>Calls are <b>coming soon</b>.</div></div>
        </div>
        <div className="font-semibold mb-3">Suggestions</div>
        <div className="space-y-2">
          {["Austin", "Thomas", "Chase", "Xavier"].map(n => (
            <div key={n} className="flex items-center justify-between bg-sky-50 rounded-xl px-3 py-2">
              <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-gray-200"></div><div className="text-sm">{n}</div></div>
              <button className="text-xs bg-primary text-white rounded-lg px-3 py-1" disabled>Add</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

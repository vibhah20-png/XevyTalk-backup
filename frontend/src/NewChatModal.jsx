import React, { useEffect, useState } from 'react'
import { useStore } from './store'

import API_URL from './config';

const API = API_URL;

export default function NewChatModal({ onClose }) {
  const { user, token, setConversations, setActiveId, setLeftTab } = useStore()
  const [allUsers, setAllUsers] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    ; (async () => {
      const r = await fetch(`${API}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      })
      const u = await r.json()
      setAllUsers(u.filter(x => x._id !== user._id))
    })()
  }, [])

  const toggle = (id) => {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }

  const createGroup = async () => {
    if (!name.trim()) {
      setError('Group name is required')
      return
    }
    if (selected.size < 2) {
      setError('Select at least 2 people for a group')
      return
    }
    setLoading(true)
    setError('')
    const r = await fetch(`${API}/api/conversations/group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ name, memberIds: [...selected] }),
      credentials: 'include'
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({ error: 'Failed to create group' }))
      setError(j.error || 'Failed to create group')
      setLoading(false)
    } else {
      const conv = await r.json()
      setConversations(cs => [conv, ...cs])
      setActiveId(conv._id)
      setLeftTab('group')
      onClose()
    }
  }

  // Filter users based on search query
  const filteredUsers = searchQuery
    ? allUsers.filter(u =>
      u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    : allUsers.slice(0, 8) // Show only first 8 users when not searching

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="w-[720px] bg-white rounded-2xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold text-lg">Create New Group</div>
          <button className="text-gray-500" onClick={onClose}>✕</button>
        </div>

        {/* Group Name Input */}
        <div className="mb-4">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2"
            placeholder="Group name"
          />
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border-0 bg-sky-50 px-3 py-2 text-sm"
            placeholder="Search users by name or email..."
          />
        </div>

        {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

        {/* Selected Count */}
        {selected.size > 0 && (
          <div className="text-sm text-gray-600 mb-2">
            {selected.size} member{selected.size !== 1 ? 's' : ''} selected
          </div>
        )}

        {/* User List */}
        <div className="max-h-[360px] overflow-y-auto space-y-2 pr-2">
          {filteredUsers.length > 0 ? (
            filteredUsers.map(u => (
              <div key={u._id} className="flex items-center justify-between bg-sky-50 rounded-xl px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-semibold">
                    {u.username?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{u.username}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(u._id)}
                    onChange={() => toggle(u._id)}
                    className="rounded"
                  />
                  Select
                </label>
              </div>
            ))
          ) : (
            <div className="text-center text-gray-500 text-sm py-4">
              {searchQuery ? 'No users found' : 'No users available'}
            </div>
          )}
        </div>

        {/* Create Button */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={createGroup}
            disabled={loading || !name.trim() || selected.size < 2}
            className="bg-primary text-white rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  )
}

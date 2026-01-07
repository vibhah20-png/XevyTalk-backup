import React, { useState, useEffect } from 'react'
import API_URL from './config'

const API = API_URL

export default function AddMemberModal({ conversationId, token, onClose, onSuccess, existingMembers = [] }) {
    const [allUsers, setAllUsers] = useState([])
    const [searchQuery, setSearchQuery] = useState('')
    const [selected, setSelected] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        // Fetch all users
        fetch(`${API}/api/users`, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include'
        })
            .then(r => r.json())
            .then(users => setAllUsers(users))
            .catch(err => {
                console.error(err)
                setError('Failed to load users')
            })
    }, [])

    // Show all users (explicitly excluding those already in the group)
    const availableUsers = allUsers.filter(u =>
        !existingMembers.some(m => String(m._id) === String(u._id))
    )

    const filteredUsers = searchQuery
        ? availableUsers.filter(u =>
            u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : availableUsers.slice(0, 8)

    const handleAdd = async () => {
        if (!selected) {
            setError('Please select a user')
            return
        }

        setLoading(true)
        setError('')

        try {
            const r = await fetch(`${API}/api/conversations/${conversationId}/add-member`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ userId: selected._id }),
                credentials: 'include'
            })

            const data = await r.json()

            if (!r.ok) {
                setError(data.error || 'Failed to add member')
                setLoading(false)
                return
            }

            onSuccess()
            onClose()
        } catch (err) {
            console.error(err)
            setError('Failed to add member')
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
            <div className="w-[90%] max-w-md bg-white rounded-2xl shadow-xl p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <div className="font-semibold text-lg">Add New Member</div>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 p-1 -mr-1"
                        aria-label="Close"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
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

                {error && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-4">
                        {error}
                    </div>
                )}

                {/* User List */}
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2 -mr-2 mb-4">
                    {filteredUsers.length > 0 ? (
                        filteredUsers.map(u => (
                            <button
                                key={u._id}
                                onClick={() => setSelected(u)}
                                className={`w-full text-left flex items-center gap-3 p-3 rounded-xl transition-colors ${selected?._id === u._id
                                    ? 'bg-primary text-white'
                                    : 'bg-sky-50/60 hover:bg-sky-100/60'
                                    }`}
                            >
                                <div className={`w-10 h-10 rounded-full grid place-items-center font-semibold text-lg flex-shrink-0 ${selected?._id === u._id
                                    ? 'bg-white/20 text-white'
                                    : 'bg-indigo-100 text-indigo-700'
                                    }`}>
                                    {u.username?.charAt(0)?.toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-medium text-sm truncate">
                                        {u.username}
                                    </div>
                                    <div className={`text-xs truncate ${selected?._id === u._id ? 'text-white/80' : 'text-gray-500'
                                        }`}>
                                        {u.email}
                                    </div>
                                </div>
                                {selected?._id === u._id && (
                                    <div className="ml-auto">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                )}
                            </button>
                        ))
                    ) : (
                        <div className="text-center text-gray-500 text-sm py-4">
                            {searchQuery ? 'No users found' : 'No users available'}
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                    <button
                        onClick={onClose}
                        className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleAdd}
                        disabled={loading || !selected}
                        className="flex-1 bg-primary text-white py-2 px-4 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Adding...' : 'Add Member'}
                    </button>
                </div>
            </div>
        </div>
    )
}

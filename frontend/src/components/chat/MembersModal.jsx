
import React, { useState, useEffect } from 'react'
import { useStore } from '../../store'
import API_URL from '../../config'
import AddMemberModal from '../../AddMemberModal'

const API = API_URL;

export default function MembersModal({ conv, onClose }) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [members, setMembers] = useState([])
    const [showAddMember, setShowAddMember] = useState(false)
    const { token, user } = useStore()

    const fetchMembers = async () => {
        if (!conv?._id) return

        try {
            setLoading(true)
            setError(null)

            // Fetch fresh conversation data to ensure we have the latest members
            const r = await fetch(`${API}/api/conversations/${conv._id}`, {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include'
            })

            if (!r.ok) {
                throw new Error('Failed to fetch group members')
            }

            const data = await r.json()
            if (data.members && Array.isArray(data.members)) {
                setMembers(data.members)
            } else {
                setMembers(conv.members || [])
            }
        } catch (err) {
            console.error('Error fetching members:', err)
            setError(err.message || 'Failed to load group members')
            setMembers(conv.members || [])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchMembers()
    }, [conv?._id, token])

    const isAdmin = (members.length > 0 && String(members[0]._id) === String(user?._id)) || user?.isAdmin

    if (!conv) {
        return (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                <div className="w-[480px] bg-white rounded-2xl shadow-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="font-semibold text-lg">Group Members</div>
                        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="text-center py-6 text-gray-500">
                        No conversation selected
                    </div>
                </div>
            </div>
        )
    }

    return (
        <>
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
                <div className="w-[90%] max-w-md bg-white rounded-2xl shadow-xl p-6" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <div className="font-semibold text-lg">Group Members</div>
                            <div className="text-xs text-gray-500">{conv.name || 'Group Chat'}</div>
                        </div>
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

                    {loading ? (
                        <div className="flex justify-center py-8">
                            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    ) : error ? (
                        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-4">
                            {error}
                        </div>
                    ) : members.length === 0 ? (
                        <div className="text-center py-6 text-gray-500">
                            No members in this group
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2 -mr-2">
                            {members.map(member => (
                                <div
                                    key={member._id}
                                    className="flex items-center gap-3 bg-sky-50/60 hover:bg-sky-100/60 rounded-xl p-3 transition-colors group"
                                >
                                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-semibold text-lg flex-shrink-0">
                                        {member.username?.charAt(0)?.toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium text-sm truncate">
                                            {member.username}
                                            {member._id === conv.members[0]?._id && (
                                                <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                                    Admin
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            {member.email || 'No email'}
                                        </div>
                                    </div>

                                    {isAdmin && String(member._id) !== String(user?._id) && (
                                        <button
                                            onClick={async (e) => {
                                                e.stopPropagation()
                                                if (!confirm(`Remove ${member.username} from group?`)) return
                                                try {
                                                    // First verify the conversation exists and user is admin
                                                    const verifyRes = await fetch(`${API}/api/conversations/${conv._id}`, {
                                                        headers: { Authorization: `Bearer ${token}` },
                                                        credentials: 'include'
                                                    });

                                                    if (!verifyRes.ok) {
                                                        throw new Error(verifyRes.status === 404 ? 'Conversation not found' : 'Failed to verify conversation');
                                                    }

                                                    const convData = await verifyRes.json();
                                                    const firstMember = convData.members[0];
                                                    const firstMemberId = firstMember?._id || firstMember;
                                                    const isGroupAdmin = convData.members.length > 0 && String(firstMemberId) === String(user?._id);

                                                    if (!isGroupAdmin && !user?.isAdmin) {
                                                        throw new Error('Only group admin or system admin can remove members');
                                                    }

                                                    // Now make the remove member request
                                                    const r = await fetch(`${API}/api/conversations/${conv._id}/remove-member`, {
                                                        method: 'POST',
                                                        headers: {
                                                            'Content-Type': 'application/json',
                                                            Authorization: `Bearer ${token}`
                                                        },
                                                        body: JSON.stringify({ userId: member._id }),
                                                        credentials: 'include'
                                                    });

                                                    const responseData = await r.json().catch(() => ({}));

                                                    if (r.ok) {
                                                        fetchMembers(); // Refresh list
                                                    } else {
                                                        throw new Error(responseData.error || `Failed to remove member: ${r.status} ${r.statusText}`);
                                                    }
                                                } catch (err) {
                                                    console.error('Remove member error:', err);
                                                    alert(`Error removing member: ${err.message}`);
                                                }
                                            }}
                                            className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-6 pt-4 border-t space-y-2">
                        <button
                            onClick={() => setShowAddMember(true)}
                            className="w-full bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition-colors"
                        >
                            + Add New User
                        </button>
                        <button
                            onClick={onClose}
                            className="w-full bg-primary text-white py-2 px-4 rounded-lg hover:bg-primary/90 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>

            {showAddMember && (
                <AddMemberModal
                    conversationId={conv._id}
                    token={token}
                    existingMembers={members}
                    onClose={() => setShowAddMember(false)}
                    onSuccess={() => {
                        fetchMembers()
                        alert('Member added successfully!')
                    }}
                />
            )}
        </>
    )
}

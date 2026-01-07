
import React from 'react'
import dayjs from 'dayjs'

export default function MessageInfoModal({ message, conv, onClose }) {
    if (!message) return null

    const members = Array.isArray(conv?.members) ? conv.members : []
    const byIds = (ids = []) => {
        if (!Array.isArray(ids)) return [];
        return members.filter(u => ids.map(String).includes(String(u._id)))
    }

    const sender = message.sender?.username ||
        members.find(m => String(m._id) === String(message.sender))?.username ||
        'Unknown'
    const senderId = String(message.sender?._id || message.sender)

    // Filter out the sender from seen/delivered lists
    const seenBy = byIds(message.seenBy || []).filter(u => String(u._id) !== senderId)
    // const deliveredTo = byIds(message.deliveredTo || []).filter(u => String(u._id) !== senderId)
    const isGroup = conv?.type === 'group'
    const totalRecipients = members.filter(m => String(m._id) !== senderId).length

    return (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
            <div className="w-[90%] max-w-md bg-white rounded-2xl shadow-xl p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <div className="font-semibold text-lg">Message Information</div>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="space-y-4 text-sm">
                    <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-gray-500 text-xs mb-1">Message</div>
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <div className="text-gray-500 text-xs mb-1">Sent by</div>
                            <div className="font-medium">{sender}</div>
                            <div className="text-xs text-gray-500">
                                {dayjs(message.createdAt).format('MMM D, YYYY h:mm A')}
                            </div>
                        </div>

                        {isGroup && (
                            <>
                                <div className="border-t my-2"></div>
                                <div>
                                    <div className="text-gray-500 text-xs mb-2">
                                        Read by {seenBy.length} of {totalRecipients}
                                    </div>
                                    {seenBy.length > 0 ? (
                                        <div className="flex flex-wrap gap-1">
                                            {seenBy.map(u => (
                                                <div key={u._id} className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded-full flex items-center gap-1">
                                                    <span>✓✓</span>
                                                    <span>{u.username}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-gray-400 text-sm">Not read yet</span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

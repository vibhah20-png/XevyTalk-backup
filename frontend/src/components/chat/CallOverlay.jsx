
import React from 'react'
import VideoTile from './VideoTile'

export default function CallOverlay({ call, localStream, remoteStreams, onEnd, conversation, currentUserId }) {
    const members = Array.isArray(conversation?.members) ? conversation.members : []
    const getNameForUser = (userId) => {
        if (!userId) return 'User'
        if (String(userId) === String(currentUserId)) return 'You'
        const m = members.find(x => String(x._id) === String(userId))
        return m?.username || 'User'
    }
    const remotePrimaryName = call.from?._id && String(call.from._id) !== String(currentUserId)
        ? (members.find(x => String(x._id) === String(call.from._id))?.username || call.from.username || 'User')
        : (members.find(x => String(x._id) !== String(currentUserId))?.username || 'User')
    const isGroup = conversation?.type === 'group' || call.isGroup
    const targetName = isGroup ? (conversation?.name || 'Group') : remotePrimaryName
    const title = call.kind === 'video'
        ? (isGroup ? `Video call from ${targetName}` : `Video call with ${targetName}`)
        : (isGroup ? `Audio call from ${targetName}` : `Audio call with ${targetName}`)
    return (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center">
            <div className="w-full max-w-4xl h-[70vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 bg-sky-50 border-b border-sky-100 text-gray-900">
                    <div>
                        <div className="font-semibold text-sm">{title}</div>
                        <div className="text-xs text-gray-500">
                            {isGroup ? (conversation?.name || 'Group') : remotePrimaryName}
                        </div>
                    </div>
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-sky-100 text-sky-700 font-semibold text-sm">
                        {(targetName || 'U').charAt(0).toUpperCase()}
                    </div>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2 p-3 bg-sky-50">
                    {localStream && (
                        <div className="relative border border-sky-100 rounded-2xl overflow-hidden bg-black">
                            <VideoTile stream={localStream} muted={true} />
                            <div className="absolute bottom-2 left-2 text-xs px-2 py-1 rounded-full bg-black/60 text-white">You</div>
                        </div>
                    )}
                    {remoteStreams.map(rs => (
                        <div key={rs.userId} className="relative border border-sky-100 rounded-2xl overflow-hidden bg-black">
                            <VideoTile stream={rs.stream} muted={false} />
                            <div className="absolute bottom-2 left-2 text-xs px-2 py-1 rounded-full bg-black/60 text-white">{getNameForUser(rs.userId)}</div>
                        </div>
                    ))}
                    {!localStream && remoteStreams.length === 0 && (
                        <div className="col-span-2 flex flex-col items-center justify-center text-gray-600 text-sm">
                            <div className="w-16 h-16 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-2xl font-semibold mb-3">
                                {(targetName || 'U').charAt(0).toUpperCase()}
                            </div>
                            <div className="text-base font-semibold mb-1">{targetName}</div>
                            <div className="text-xs text-gray-400">Calling… waiting for media to connect</div>
                        </div>
                    )}
                </div>
                <div className="py-3 flex items-center justify-center gap-4 bg-white border-t border-gray-100">
                    <button
                        onClick={onEnd}
                        className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white text-lg"
                    >
                        <span className="material-icons">call_end</span>
                    </button>
                </div>
            </div>
        </div>
    )
}

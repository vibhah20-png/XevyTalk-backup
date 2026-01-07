
import React from 'react'

export default function IncomingCallModal({ call, onAccept, onReject, conversations }) {
    const conversation = conversations?.find(c => c._id === call.conversationId)
    const isGroup = conversation?.type === 'group'
    const displayName = isGroup
        ? (conversation?.name || 'Group')
        : (call.from?.username || 'Unknown user')
    const callType = call.kind === 'video' ? 'video' : 'voice'
    // const avatar = call.from?.avatar || `https://api.dicebear.com/8.x/pixel-art/svg?seed=${encodeURIComponent(displayName)}`

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center backdrop-blur-sm animate-fade-in">
            <div className="w-[320px] bg-gray-900/90 rounded-3xl shadow-2xl p-8 flex flex-col items-center border border-white/10 relative overflow-hidden">
                {/* Animated Rings */}
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-indigo-500/20 rounded-full animate-ping"></div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-60 h-60 bg-indigo-500/10 rounded-full animate-ping delay-300"></div>
                </div>

                <div className="relative z-10 flex flex-col items-center w-full">
                    <div className="w-24 h-24 rounded-full border-4 border-gray-800 shadow-xl overflow-hidden mb-4 bg-gray-700 flex items-center justify-center">
                        <div className="text-4xl font-bold text-white">
                            {displayName.charAt(0).toUpperCase()}
                        </div>
                    </div>

                    <div className="text-white text-xl font-bold mb-1 text-center">{displayName}</div>
                    <div className="text-gray-400 text-sm mb-8 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        Incoming {callType} call...
                    </div>

                    <div className="flex items-center justify-between w-full gap-6">
                        <button
                            onClick={onReject}
                            className="flex-1 flex flex-col items-center gap-2 group"
                        >
                            <div className="w-14 h-14 rounded-full bg-red-500/20 text-red-500 group-hover:bg-red-500 group-hover:text-white transition-all flex items-center justify-center">
                                <span className="material-icons text-2xl">call_end</span>
                            </div>
                            <span className="text-xs text-gray-400 group-hover:text-white transition-colors">Decline</span>
                        </button>

                        <button
                            onClick={onAccept}
                            className="flex-1 flex flex-col items-center gap-2 group"
                        >
                            <div className="w-14 h-14 rounded-full bg-green-500 text-white shadow-lg shadow-green-500/40 group-hover:scale-110 transition-transform flex items-center justify-center animate-bounce">
                                <span className="material-icons text-2xl">call</span>
                            </div>
                            <span className="text-xs text-green-400 font-medium group-hover:text-white transition-colors">Accept</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

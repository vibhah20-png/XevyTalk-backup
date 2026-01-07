import React, { useState, useEffect, useRef } from 'react'
import dayjs from 'dayjs'

const AUTOPLAY_RESUME_EVENTS = ['pointerdown', 'keydown', 'touchstart']
const awaitingPlaybackElements = new WeakSet()

const ensureMediaPlayback = (element) => {
    if (!element?.play) return
    const playPromise = element.play()
    if (playPromise?.catch) {
        playPromise.catch(err => {
            if (!err || err.name !== 'NotAllowedError') return
            if (typeof window === 'undefined') return
            if (!element || typeof element !== 'object') return
            if (awaitingPlaybackElements.has(element)) return
            awaitingPlaybackElements.add(element)

            const finalize = () => awaitingPlaybackElements.delete(element)
            const resume = () => {
                const resumed = element.play()
                if (resumed?.finally) {
                    resumed.finally(finalize)
                } else if (resumed?.then) {
                    resumed.then(finalize).catch(finalize)
                } else {
                    finalize()
                }
            }

            const once = () => {
                AUTOPLAY_RESUME_EVENTS.forEach(evt => window.removeEventListener(evt, once))
                resume()
            }

            AUTOPLAY_RESUME_EVENTS.forEach(evt => window.addEventListener(evt, once, { once: true }))
        })
    }
}

const bindStreamToElement = (element, stream, { muted = false, volume } = {}) => {
    if (!element || !stream) return
    if (element.srcObject !== stream) {
        element.srcObject = stream
    }
    if (typeof muted === 'boolean') {
        element.muted = muted
        element.defaultMuted = muted
    }
    if (typeof volume === 'number') {
        element.volume = volume
    }
    element.playsInline = true
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => ensureMediaPlayback(element))
    } else {
        setTimeout(() => ensureMediaPlayback(element), 0)
    }
}

export default function CallPage({
    call,
    localStream,
    localScreenStream,
    remoteStreams,
    onEnd,
    onToggleMic,
    onToggleCamera,
    onStartScreen,
    onStopScreen,
    isMicOn,
    isCameraOn,
    isScreenSharing,
    conversation,
    currentUser,
    messages,
    onSendMessage,
    participantStates = {},
    token,
    apiBase,
    decrypt
}) {
    const [duration, setDuration] = useState(0)
    const [showChat, setShowChat] = useState(false)
    const [showMembers, setShowMembers] = useState(false)
    const [chatUnread, setChatUnread] = useState(0)
    const prevMsgCountRef = useRef(messages?.length || 0)

    useEffect(() => {
        const currentCount = messages?.length || 0
        const prev = prevMsgCountRef.current
        if (!showChat && currentCount > prev) {
            setChatUnread(c => c + (currentCount - prev))
        }
        prevMsgCountRef.current = currentCount
    }, [messages?.length, showChat])

    const clearChatUnread = () => setChatUnread(0)

    useEffect(() => {
        const start = Date.now()
        const timer = setInterval(() => {
            setDuration(Math.floor((Date.now() - start) / 1000))
        }, 1000)
        return () => clearInterval(timer)
    }, [])

    const formatTime = (s) => {
        const m = Math.floor(s / 60)
        const sec = s % 60
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    }

    const members = Array.isArray(conversation?.members) ? conversation.members : []

    useEffect(() => {
        remoteStreams.forEach(rs => {
            rs.stream?.getAudioTracks?.().forEach(track => {
                if (!track.enabled) track.enabled = true
            })
        })
    }, [remoteStreams])

    // Helper to get name/avatar
    const getRemoteUser = () => {
        if (!call) return { name: 'User', initial: 'U' }

        if (conversation?.type === 'direct') {
            const other = members.find(m => String(m._id) !== String(currentUser?._id))
            return {
                name: other?.username || 'User',
                initial: (other?.username || 'U').charAt(0).toUpperCase()
            }
        }

        const remoteId = call.from?._id || call.from
        const user = members.find(m => String(m._id) === String(remoteId))
        return {
            name: user?.username || 'Unknown',
            initial: (user?.username || 'U').charAt(0).toUpperCase()
        }
    }

    const remoteUser = getRemoteUser()
    const myInitial = (currentUser?.username || 'Me').charAt(0).toUpperCase()

    // Identify presenters and types of streams
    console.log('🔍 CallPage Debug:', {
        participantStates,
        remoteStreams: remoteStreams.map(rs => ({
            userId: rs.userId,
            audioTracks: rs.stream.getAudioTracks().length,
            videoTracks: rs.stream.getVideoTracks().length
        })),
        isScreenSharing,
        localScreenStream: !!localScreenStream
    });

    // --- SMART PRESENTER DETECTION ALGORITHM ---

    // 1. Find who is presenting based on signaling AND stream characteristics
    let inferredPresenterId = null;
    let presentationStream = null;

    // Check if I am sharing
    if (localScreenStream) {
        inferredPresenterId = currentUser?._id;
        presentationStream = localScreenStream;
    } else {
        // Look for remote presenters
        const signaledPresenterId = Object.keys(participantStates).find(uid => participantStates[uid]?.isScreenSharing);

        if (signaledPresenterId) {
            inferredPresenterId = signaledPresenterId;
            const userStreams = remoteStreams.filter(rs => String(rs.userId) === String(signaledPresenterId));

            // Prefer streams with NO audio tracks (likely screen share)
            const screenStreams = userStreams.filter(rs => rs.stream.getAudioTracks().length === 0);
            const cameraStreams = userStreams.filter(rs => rs.stream.getAudioTracks().length > 0);

            if (screenStreams.length > 0) {
                // Pick the newest screen stream
                screenStreams.sort((a, b) => (b._ts || 0) - (a._ts || 0));
                presentationStream = screenStreams[0].stream;
            } else if (userStreams.length > 1) {
                // Fallback: Pick newest if multiple exist (unlikely to reach here if logic above holds)
                userStreams.sort((a, b) => (b._ts || 0) - (a._ts || 0));
                presentationStream = userStreams[0].stream;
            } else {
                // User is signaled as sharing, but no screen stream arrived yet.
                // WE DO NOT set presentationStream to the camera stream here.
                // This prevents the "camera as presentation" issue during race conditions.
                console.log('⏳ Signaled presenter detected, but waiting for screen stream...');
                presentationStream = null;
            }
        }

        // Priority 2: Fallback - Any user with > 1 stream implies presentation even without signal
        if (!presentationStream) {
            const multiStreamUser = [...new Set(remoteStreams.map(rs => rs.userId))].find(userId => {
                return remoteStreams.filter(rs => rs.userId === userId).length > 1;
            });

            if (multiStreamUser) {
                inferredPresenterId = multiStreamUser;
                const userStreams = remoteStreams.filter(rs => String(rs.userId) === String(multiStreamUser));
                const screenStreams = userStreams.filter(rs => rs.stream.getAudioTracks().length === 0);

                if (screenStreams.length > 0) {
                    screenStreams.sort((a, b) => (b._ts || 0) - (a._ts || 0));
                    presentationStream = screenStreams[0].stream;
                } else {
                    userStreams.sort((a, b) => (b._ts || 0) - (a._ts || 0));
                    presentationStream = userStreams[0].stream;
                }
                console.log('🤖 Detected implicit presenter (multi-stream):', multiStreamUser);
            }
        }

        // Priority 3: Removed to prevent false positives and sticky layout
    }

    const presenterUser = inferredPresenterId ? members.find(m => String(m._id) === String(inferredPresenterId)) : null;
    const isRemotePresenting = !!inferredPresenterId && String(inferredPresenterId) !== String(currentUser?._id);
    const isSharing = !!presentationStream;
    const mainPresentationStream = presentationStream;

    console.log('🎯 Final Presentation Decision:', {
        presenter: presenterUser?.username || inferredPresenterId,
        isRemote: isRemotePresenting,
        hasStream: !!mainPresentationStream,
        method: localScreenStream ? 'local' : (participantStates[inferredPresenterId]?.isScreenSharing ? 'signaled' : 'inferred')
    });

    const toggleChat = () => {
        setShowChat(!showChat)
        if (!showChat) {
            setShowMembers(false)
            clearChatUnread()
        }
    }

    const toggleMembers = () => {
        setShowMembers(!showMembers)
        if (!showMembers) setShowChat(false)
    }

    return (
        <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden">
            {/* Top Bar */}
            <div className="h-14 flex items-center justify-between px-4 bg-gray-800/90 backdrop-blur-sm border-b border-gray-700 text-white shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                    <div className="font-mono text-sm tracking-wider">{formatTime(duration)}</div>
                    <div className="h-4 w-px bg-gray-600 mx-2"></div>
                    <div className="text-sm font-medium opacity-90">{conversation?.name || remoteUser.name}</div>
                    <div className="h-4 w-px bg-gray-600 mx-2"></div>
                    <div className="text-xs opacity-70 flex items-center gap-1">
                        <span className="material-icons text-sm">people</span>
                        <span>{remoteStreams.length + 1}</span>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {isRemotePresenting && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 mr-2 border border-indigo-500/20">
                            <span className="material-icons text-sm animate-pulse">screen_share</span>
                            <span className="text-xs font-medium">{presenterUser?.username || 'Participant'} is presenting</span>
                        </div>
                    )}
                    <TopBarButton
                        icon="chat_bubble_outline"
                        label="Chat"
                        active={showChat}
                        onClick={toggleChat}
                        badge={chatUnread > 0 ? chatUnread : null}
                    />
                    <TopBarButton
                        icon="people_outline"
                        label="People"
                        active={showMembers}
                        onClick={toggleMembers}
                    />

                    <div className="h-6 w-px bg-gray-600 mx-3"></div>

                    <TopBarButton
                        icon={isCameraOn ? "videocam" : "videocam_off"}
                        label="Camera"
                        active={isCameraOn}
                        onClick={onToggleCamera}
                        danger={!isCameraOn}
                    />
                    <TopBarButton
                        icon={isMicOn ? "mic" : "mic_off"}
                        label="Mic"
                        active={isMicOn}
                        onClick={onToggleMic}
                        danger={!isMicOn}
                    />
                    <TopBarButton
                        icon="screen_share"
                        label={isScreenSharing ? "Sharing..." : "Share"}
                        active={isScreenSharing}
                        onClick={isScreenSharing ? undefined : onStartScreen}
                        disabled={isScreenSharing}
                    />

                    <button
                        onClick={onEnd}
                        className="ml-4 bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-lg shadow-red-900/20"
                    >
                        <span className="material-icons text-sm">call_end</span>
                        Leave
                    </button>
                </div>
            </div>

            {/* Presentation Info Bar (Google Meet Style) */}
            {isSharing && (
                <div className="h-12 flex items-center justify-between px-6 bg-gray-800/80 backdrop-blur-md border-b border-gray-700/50 text-white shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="material-icons text-indigo-400 text-lg">screen_share</span>
                        <span className="text-sm font-medium tracking-tight">
                            {isScreenSharing ? `${currentUser?.username || 'You'} (You, presenting)` : `${presenterUser?.username || 'Participant'} is presenting`}
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 text-[11px] opacity-70">
                            <span className="material-icons text-[14px]">volume_up</span>
                            <span>Presentation audio</span>
                        </div>
                        {isScreenSharing && (
                            <button
                                onClick={onStopScreen}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-1.5 rounded-full text-sm font-medium transition-all shadow-lg active:scale-95 flex items-center gap-2"
                            >
                                Stop presenting
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden relative">
                {/* Stage - Dynamic Layout */}
                <div className="flex-1 relative bg-gray-900 min-w-0 overflow-hidden">
                    {isSharing ? (
                        /* Sidebar Layout View: Presentation on Main, All cameras on Sidebar */
                        <div className="flex w-full h-full bg-black overflow-hidden">
                            {/* Main Stage (Presentation) */}
                            <div className="flex-1 relative min-w-0 h-full flex items-center justify-center bg-gray-950">
                                {mainPresentationStream ? (
                                    <video
                                        key={mainPresentationStream.id}
                                        ref={el => bindStreamToElement(el, mainPresentationStream, { muted: true, volume: 0 })}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="w-full h-full object-contain"
                                    />
                                ) : (
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="w-20 h-20 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                                            <span className="material-icons text-4xl text-indigo-400 animate-pulse">monitor</span>
                                        </div>
                                        <div className="text-gray-400 text-sm font-medium">Waiting for presentation...</div>
                                    </div>
                                )}

                                {/* Bottom Action Bar Overlay inside share view */}
                                <div className="absolute bottom-6 right-6 flex items-center gap-2">
                                    <button className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white flex items-center justify-center transition-colors">
                                        <span className="material-icons-outlined">fullscreen</span>
                                    </button>
                                    <button className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white flex items-center justify-center transition-colors">
                                        <span className="material-icons-outlined">aspect_ratio</span>
                                    </button>
                                </div>
                            </div>

                            {/* Participants Vertical Sidebar */}
                            <div className="w-72 xl:w-80 flex-none bg-black/20 border-l border-white/5 overflow-y-auto p-4 flex flex-col gap-4">
                                {/* Local Camera in Sidebar */}
                                <div className="w-full aspect-video bg-gray-800 rounded-2xl overflow-hidden relative border border-white/10 group shadow-2xl">
                                    {localStream && isCameraOn ? (
                                        <video
                                            ref={el => bindStreamToElement(el, localStream, { muted: true, volume: 0 })}
                                            autoPlay
                                            playsInline
                                            muted
                                            className="w-full h-full object-cover transform scale-x-[-1]"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800">
                                            <div className="w-12 h-12 rounded-full bg-gray-700 text-gray-400 flex items-center justify-center text-xl font-bold">
                                                {myInitial}
                                            </div>
                                        </div>
                                    )}
                                    <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded bg-black/60 backdrop-blur-md text-[11px] text-white font-medium flex items-center gap-2 border border-white/5">
                                        {currentUser?.username || 'You'} (Me)
                                        {!isMicOn && <span className="material-icons text-red-500 text-[10px]">mic_off</span>}
                                    </div>
                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center">
                                            <span className="material-icons text-sm">push_pin</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Remote Streams in Sidebar */}
                                {remoteStreams
                                    .filter(rs => {
                                        // Filter out streams that are actually the presentation (0 audio tracks)
                                        const isThisPresenter = String(rs.userId) === String(inferredPresenterId);
                                        const hasAudio = rs.stream.getAudioTracks().length > 0;

                                        // If this is the presenter, only show their stream if it's NOT the presentation stream
                                        if (isThisPresenter && rs.stream.id === mainPresentationStream?.id) {
                                            return false;
                                        }
                                        return true;
                                    })
                                    .map(rs => {
                                        const u = members.find(m => String(m._id) === String(rs.userId))
                                        const name = u?.username || 'Participant'
                                        const isCamOff = participantStates[rs.userId]?.isCameraOff
                                        const hasVideoTrack = rs.stream.getVideoTracks().length > 0 && rs.stream.getVideoTracks().some(t => t.enabled);
                                        const showVideo = isCamOff === false || (isCamOff === undefined && hasVideoTrack);

                                        return (
                                            <div key={rs.stream.id} className="w-full aspect-video bg-gray-800 rounded-2xl overflow-hidden relative border border-white/10 group shadow-2xl">
                                                {showVideo ? (
                                                    <video
                                                        ref={el => bindStreamToElement(el, rs.stream, { muted: true })}
                                                        autoPlay
                                                        playsInline
                                                        muted
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                                                        <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center text-xl font-bold">
                                                            {(name || 'U').charAt(0).toUpperCase()}
                                                        </div>
                                                    </div>
                                                )}
                                                <audio
                                                    ref={el => bindStreamToElement(el, rs.stream, { muted: false, volume: 1 })}
                                                    autoPlay
                                                    playsInline
                                                    className="hidden"
                                                />
                                                <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded bg-black/60 backdrop-blur-md text-[11px] text-white font-medium flex items-center gap-2 border border-white/5">
                                                    {name}
                                                    {participantStates[rs.userId]?.isMicOff && (
                                                        <span className="material-icons text-red-500 text-[10px]">mic_off</span>
                                                    )}
                                                </div>
                                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center">
                                                        <span className="material-icons text-sm">push_pin</span>
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                            </div>
                        </div>
                    ) : (() => {
                        // Count unique remote participants (not streams, as one user can have multiple streams)
                        const uniqueRemoteUserIds = new Set(remoteStreams.filter(rs => rs.stream.getAudioTracks().length > 0).map(rs => rs.userId));
                        return uniqueRemoteUserIds.size === 1;
                    })() ? (
                        /* Premium 1:1 View */
                        <div className="absolute inset-0 w-full h-full bg-black">
                            {/* Large Remote Participant */}
                            {remoteStreams
                                .filter(rs => rs.stream.getAudioTracks().length > 0)
                                .map(rs => {
                                    const u = members.find(m => String(m._id) === String(rs.userId))
                                    const name = u?.username || 'Participant'
                                    const isCamOff = participantStates[rs.userId]?.isCameraOff
                                    const hasVideoTrack = rs.stream.getVideoTracks().length > 0 && rs.stream.getVideoTracks().some(t => t.enabled);
                                    const showVideo = isCamOff === false || (isCamOff === undefined && hasVideoTrack);

                                    return (
                                        <div key={rs.stream.id} className="w-full h-full relative">
                                            {showVideo ? (
                                                <video
                                                    ref={el => bindStreamToElement(el, rs.stream, { muted: true })}
                                                    autoPlay
                                                    playsInline
                                                    muted
                                                    className="w-full h-full object-contain"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950">
                                                    <div className="relative">
                                                        <div className="w-32 h-32 md:w-48 md:h-48 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center text-4xl md:text-6xl font-bold text-primary shadow-2xl animate-pulse">
                                                            {(name || 'U').charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white text-sm font-medium whitespace-nowrap">
                                                            Audio Call...
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            <audio
                                                ref={el => bindStreamToElement(el, rs.stream, { muted: false, volume: 1 })}
                                                autoPlay
                                                playsInline
                                                className="hidden"
                                            />
                                            <div className="absolute bottom-6 left-6 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-md text-white text-sm font-medium border border-white/10 flex items-center gap-2">
                                                {name}
                                                {participantStates[rs.userId]?.isMicOff && (
                                                    <span className="material-icons text-red-500 text-sm">mic_off</span>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}

                            {/* Small Inset Local User */}
                            <div className="absolute bottom-6 right-6 w-48 sm:w-64 aspect-video bg-gray-800 rounded-xl overflow-hidden shadow-2xl ring-2 ring-white/20 z-10">
                                {localStream && isCameraOn ? (
                                    <video
                                        ref={el => bindStreamToElement(el, localStream, { muted: true, volume: 0 })}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="w-full h-full object-cover transform scale-x-[-1]"
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gray-800/80">
                                        <div className="w-10 h-10 rounded-full bg-gray-700 text-gray-300 flex items-center justify-center text-lg font-semibold mb-1">
                                            {myInitial}
                                        </div>
                                        <span className="text-[10px]">You</span>
                                    </div>
                                )}
                                {!isMicOn && (
                                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center">
                                        <span className="material-icons text-xs">mic_off</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* Premium Dynamic Grid View for Group Calls */
                        <div className="absolute inset-0 bg-gray-950 p-6 overflow-hidden">
                            <div className="w-full h-full flex flex-wrap items-center justify-center gap-4 content-center">
                                {(() => {
                                    const allParticipants = [
                                        { isMe: true, id: currentUser?._id, name: 'You (Me)', stream: localStream, isCameraOn: isCameraOn, isMicOff: !isMicOn },
                                        ...remoteStreams
                                            .filter(rs => rs.stream.getAudioTracks().length > 0) // Only camera streams
                                            .map(rs => {
                                                const u = members.find(m => String(m._id) === String(rs.userId))
                                                return {
                                                    isMe: false,
                                                    id: rs.userId,
                                                    name: u?.username || 'Participant',
                                                    stream: rs.stream,
                                                    isCameraOn: participantStates[rs.userId]?.isCameraOff === false,
                                                    isMicOff: participantStates[rs.userId]?.isMicOff
                                                }
                                            })
                                    ];

                                    const total = allParticipants.length;

                                    // Calculate dimensions for a clean grid
                                    // We want to fill the screen as much as possible
                                    let cols = total <= 1 ? 1 : total <= 2 ? 2 : total <= 4 ? 2 : total <= 6 ? 3 : total <= 9 ? 3 : 4;
                                    let rows = total <= 2 ? 1 : total <= 6 ? 2 : 3;

                                    // Dynamic scaling factor to ensure boxes fit snugly
                                    const gap = 16;
                                    const width = `calc(${100 / cols}% - ${(gap * (cols - 1)) / cols}px)`;
                                    const height = `calc(${100 / rows}% - ${(gap * (rows - 1)) / rows}px)`;

                                    return (
                                        <>
                                            {allParticipants.map((p, idx) => (
                                                <div
                                                    key={p.isMe ? 'me' : p.id + idx}
                                                    style={{ width, height, minWidth: '280px', minHeight: '180px' }}
                                                    className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/5 transition-all hover:ring-2 hover:ring-indigo-500/50 group"
                                                >
                                                    {p.stream && p.isCameraOn ? (
                                                        <video
                                                            ref={el => bindStreamToElement(el, p.stream, { muted: p.isMe, volume: p.isMe ? 0 : 1 })}
                                                            autoPlay
                                                            playsInline
                                                            muted={p.isMe}
                                                            className={`w-full h-full object-cover ${p.isMe ? 'scale-x-[-1]' : ''}`}
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                                                            <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center text-3xl font-bold shadow-xl">
                                                                {(p.name || 'U').charAt(0).toUpperCase()}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Participant Info Overlay */}
                                                    <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                                        <div className="px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 text-white text-[11px] font-medium flex items-center gap-2 transition-opacity group-hover:bg-black/60">
                                                            {p.name}
                                                            {p.isMicOff && (
                                                                <span className="material-icons text-red-500 text-[12px]">mic_off</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Speaking Indicator Border */}
                                                    <div className="absolute inset-0 pointer-events-none border-2 border-indigo-500 opacity-0 transition-opacity rounded-2xl" id={`speaking-${p.id}`}></div>
                                                </div>
                                            ))}
                                            {/* Special Placeholder for Empty 1:1 Connecting State */}
                                            {remoteStreams.length === 0 && call && (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/50 backdrop-blur-sm z-20">
                                                    <div className="relative">
                                                        <div className="w-24 h-24 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-4xl font-bold animate-pulse">
                                                            {remoteUser.initial}
                                                        </div>
                                                        <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-yellow-500 rounded-full border-4 border-gray-800 animate-bounce"></div>
                                                    </div>
                                                    <div className="text-white font-semibold mt-4 text-lg">{remoteUser.name}</div>
                                                    <div className="text-gray-400 text-sm mt-1 tracking-wide uppercase font-bold text-[10px]">Calling...</div>
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    )}
                </div>

                {/* Side Panel - Responsive */}
                {
                    (showChat || showMembers) && (
                        <div className="w-full sm:w-80 md:w-96 lg:w-80 bg-white border-l border-gray-200 flex flex-col shadow-xl animate-slide-in-right">
                            <div className="h-14 border-b flex items-center justify-between px-4 bg-gray-50 flex-shrink-0">
                                <div className="font-semibold text-gray-700">
                                    {showChat ? 'Meeting Chat' : 'Participants'}
                                </div>
                                <button onClick={() => { setShowChat(false); setShowMembers(false) }} className="text-gray-500 hover:text-gray-700">
                                    <span className="material-icons text-xl">close</span>
                                </button>
                            </div>

                            <div className="flex-1 overflow-hidden relative min-h-0">
                                {showChat && (
                                    <ChatPanel
                                        messages={messages}
                                        onSend={onSendMessage}
                                        currentUser={currentUser}
                                        members={members}
                                        decrypt={decrypt}
                                    />
                                )}
                                {showMembers && (
                                    <MembersPanel
                                        members={members}
                                        currentUser={currentUser}
                                        conversation={conversation}
                                        token={token}
                                        apiBase={apiBase}
                                        remoteStreams={remoteStreams}
                                        localStream={localStream}
                                        isMicOn={isMicOn}
                                        isCameraOn={isCameraOn}
                                    />
                                )}
                            </div>
                        </div>
                    )
                }
            </div >
        </div >
    )
}

function TopBarButton({ icon, label, active = true, onClick, danger = false, badge = null, disabled = false }) {
    return (
        <button
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            className={`flex flex-col items-center justify-center w-16 py-1.5 rounded-lg transition-all duration-200 
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${active && !danger && !disabled ? 'text-white hover:bg-white/10' : ''}
        ${!active && !danger && !disabled ? 'text-gray-400 hover:text-white hover:bg-white/5' : ''}
        ${danger && !disabled ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : ''}
      `}
        >
            <span className={`material-icons text-xl mb-0.5 ${danger ? 'text-red-400' : ''}`}>{icon}</span>
            <span className="text-[10px] font-medium opacity-80">{label}</span>
            {badge ? (
                <span className="mt-1 text-[10px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5">
                    {badge > 9 ? '9+' : badge}
                </span>
            ) : null}
        </button>
    )
}

function ChatPanel({ messages, onSend, currentUser, members, decrypt }) {
    const [text, setText] = useState('')
    const listRef = useRef(null)

    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight
        }
    }, [messages])

    const handleSend = () => {
        if (!text.trim()) return
        onSend(text)
        setText('')
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50" ref={listRef}>
                {messages.map(m => (
                    <MessageBubble key={m._id || m.tempId} m={m} me={currentUser._id} members={members} totalMembers={members.length} decrypt={decrypt} />
                ))}
            </div>
            <div className="p-3 border-t bg-white">
                <div className="flex items-center gap-2 bg-gray-100 rounded-full px-4 py-2">
                    <input
                        value={text}
                        onChange={e => setText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        className="flex-1 bg-transparent border-0 text-sm focus:ring-0 p-0"
                        placeholder="Type a message..."
                    />
                    <button onClick={handleSend} className="text-primary hover:text-primary/80">
                        <span className="material-icons text-xl">send</span>
                    </button>
                </div>
            </div>
        </div>
    )
}

function MembersPanel({ members, currentUser, conversation, token, apiBase, remoteStreams = [], localStream, isMicOn, isCameraOn }) {
    const [search, setSearch] = useState('')
    const [results, setResults] = useState([])
    const [loading, setLoading] = useState(false)
    const [info, setInfo] = useState(null)
    const searchTimeout = useRef()

    // Allow adding participants to both group AND direct calls
    const canAddParticipants = conversation && (conversation.type === 'group' || conversation.type === 'direct')

    useEffect(() => {
        if (search.trim()) {
            clearTimeout(searchTimeout.current)
            searchTimeout.current = setTimeout(() => {
                searchUsers()
            }, 300)
        } else {
            setResults([])
        }
        return () => clearTimeout(searchTimeout.current)
    }, [search])

    const searchUsers = async () => {
        if (!search.trim()) { setResults([]); return }
        setLoading(true)
        try {
            const r = await fetch(`${apiBase}/api/users`, {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include'
            })
            const list = await r.json()
            const lower = search.toLowerCase()
            // Show ALL matching users, regardless of membership
            const filtered = list
                .filter(u =>
                    u.username?.toLowerCase().includes(lower) || u.email?.toLowerCase().includes(lower)
                )
                .slice(0, 5)
            setResults(filtered)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    const addMember = async (userId) => {
        if (!conversation?._id) return
        try {
            setLoading(true)
            const r = await fetch(`${apiBase}/api/conversations/${conversation._id}/add-member`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ userId }),
                credentials: 'include'
            })
            const data = await r.json()
            if (!r.ok) {
                setInfo(data.error || 'Failed to add participant')
            } else {
                setInfo('Participant added! They\'ll be notified to join the call.')
                setSearch('')
                setResults([])
            }
        } catch (e) {
            console.error(e)
            setInfo('Failed to add participant')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="sticky top-0 z-10 bg-white border-b">
                {/* Search Bar */}
                {canAddParticipants && (
                    <div className="p-3">
                        <div className="relative">
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search participants..."
                                className="w-full rounded-lg border-0 bg-gray-100 px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors"
                            />
                            {loading && (
                                <div className="absolute right-3 top-2.5 text-gray-400">
                                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                </div>
                            )}
                        </div>
                        {info && <div className="mt-1 text-xs text-green-600">{info}</div>}
                    </div>
                )}

                {/* Search Results */}
                {search.trim() && results.length > 0 && (
                    <div className="border-t border-gray-100">
                        <div className="px-3 py-2 text-xs font-medium text-gray-500">Search Results</div>
                        <div className="pb-2 px-2 space-y-1">
                            {results.map(u => (
                                <div key={u._id} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-medium">
                                            {(u.username || 'U').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="text-sm">{u.username || u.email}</div>
                                    </div>
                                    <button
                                        onClick={() => addMember(u._id)}
                                        disabled={loading}
                                        className="text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded-md transition-colors"
                                    >
                                        Add
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Participants List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
                <div className="px-2 py-1 text-xs text-gray-500 font-medium">
                    {members.length} {members.length === 1 ? 'Participant' : 'Participants'}
                </div>
                {members.map(m => {
                    const isCurrentUser = String(m._id) === String(currentUser._id)
                    return (
                        <div key={m._id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                            <div className="relative">
                                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold text-sm">
                                    {(m.username || 'U').charAt(0).toUpperCase()}
                                </div>
                                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white"></div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                    {m.username}
                                    {isCurrentUser && <span className="text-gray-400 ml-1">(You)</span>}
                                </div>
                                {(() => {
                                    // Determine if member is active in the call
                                    const isRemoteActive = remoteStreams.some(rs => String(rs.userId) === String(m._id))
                                    const isActive = (isCurrentUser && (localStream || isMicOn || isCameraOn)) || isRemoteActive || m.status === 'in_call'

                                    return (
                                        <div className={`text-xs truncate ${isActive ? 'text-green-600' : 'text-gray-400'}`}>
                                            {isActive ? 'In call' : 'Waiting to join'}
                                        </div>
                                    )
                                })()}
                            </div>
                        </div>
                    )
                })}

            </div>
        </div>
    )
}

function MessageBubble({ m, me, members, totalMembers, decrypt }) {
    const [viewingAttachment, setViewingAttachment] = useState(null);
    const mine = String((m.sender && m.sender._id) || m.sender) === String(me);

    // --- E2EE Local Decryption ---
    // Backend already decrypts server-side encryption, so content should be plaintext
    // Only try E2EE decryption if content looks like E2EE encrypted format
    let content = m.content || ''
    let isEncryptedMsg = false

    // Check if it looks like E2EE encrypted (not backend encrypted)
    // E2EE format: 'nonce:ciphertext' (exactly 2 parts with ':')
    // Backend format: 'iv:tag:data' (3 parts with ':')
    const looksLikeE2EEEncrypted = decrypt &&
        typeof content === 'string' &&
        content.trim().length > 0 &&
        content.includes(':') &&
        content.split(':').length === 2 && // E2EE has 2 parts
        !content.includes(' ') && // Encrypted won't have spaces
        content.length > 40 && // Minimum encrypted length
        /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(content) // Both parts should be base64-like

    if (looksLikeE2EEEncrypted) {
        try {
            // Pass sender object if available, OR look it up in members list
            let senderObj = (m.sender && typeof m.sender === 'object') ? m.sender : null

            if (!senderObj && members) {
                const senderId = String(m.sender?._id || m.sender)
                senderObj = members.find(mem => String(mem._id) === senderId)
            }

            // Fallback if still not found (won't solve key missing but prevents crash)
            if (!senderObj) senderObj = { _id: m.sender }

            // If I sent the message, decrypt using the OTHER person's public key
            if (String(senderObj._id) === String(me)) {
                const other = members?.find(x => String(x._id) !== String(me))
                if (other) senderObj = other
            }

            // Only try to decrypt if we have keys available
            if (senderObj?.publicKey || (members && members.some(mem => mem?.publicKey))) {
                const dec = decrypt(content, senderObj)
                // Only replace if decryption returned something different and valid
                if (dec && dec !== content && dec.trim().length > 0) {
                    content = dec
                    isEncryptedMsg = false
                } else {
                    // Decryption failed - show original content (might be plaintext that matches pattern)
                    isEncryptedMsg = false
                }
            } else {
                // No keys available - assume plaintext
                isEncryptedMsg = false
            }
        } catch (e) {
            console.error('Decryption error in CallPage:', e)
            // On error, show original content instead of "Encrypted Message"
            isEncryptedMsg = false
        }
    } else {
        // Doesn't look like E2EE encrypted - it's plaintext from backend
        isEncryptedMsg = false
    }
    // Content is already plaintext from backend if it doesn't match E2EE format
    // -----------------------------

    const formatFileSize = (bytes) => {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const handleAttachmentClick = (e, attachment) => {
        e.preventDefault();
        e.stopPropagation();

        // For PDFs, open in a new tab for viewing
        if (attachment.type.includes('pdf')) {
            window.open(attachment.url || attachment.fileURL, '_blank');
            return;
        }

        // For other file types, open in the preview modal
        setViewingAttachment(attachment);
    };

    const handleDownload = (e, attachment) => {
        e.preventDefault();
        e.stopPropagation();

        // If we're in the preview modal, close it after starting download
        if (viewingAttachment) {
            setViewingAttachment(null);
        }

        const link = document.createElement('a');
        link.href = attachment.url || attachment.fileURL;
        link.download = attachment.name || 'download';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleAttachmentKeyDown = (e, attachment) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleAttachmentClick(e, attachment);
        }
    };

    const getFileIcon = (type) => {
        if (type.startsWith('image/')) return 'image';
        if (type.startsWith('video/')) return 'movie';
        if (type.startsWith('audio/')) return 'audio_file';
        if (type.includes('pdf')) return 'picture_as_pdf';
        if (type.includes('word') || type.includes('document')) return 'description';
        if (type.includes('spreadsheet') || type.includes('excel')) return 'table_chart';
        if (type.includes('presentation') || type.includes('powerpoint')) return 'slideshow';
        if (type.includes('zip') || type.includes('compressed')) return 'folder_zip';
        return 'insert_drive_file';
    };

    const renderAttachmentPreview = (attachment) => {
        const isImage = attachment.type.startsWith('image/');
        const isMedia = attachment.type.startsWith('video/') || attachment.type.startsWith('audio/');
        const isPDF = attachment.type.includes('pdf');

        return (
            <div className="relative group">
                <div
                    className={`${isImage || isPDF ? '' : 'p-3 bg-gray-50 rounded-lg'} ${isPDF ? 'cursor-pointer hover:bg-gray-50 rounded-lg p-2' : ''}`}
                    onClick={(e) => handleAttachmentClick(e, attachment)}
                    onKeyDown={(e) => handleAttachmentKeyDown(e, attachment)}
                    role="button"
                    tabIndex={0}
                >
                    {isPDF && (
                        <div className="flex items-center gap-2 p-2 hover:bg-gray-100 rounded">
                            <span className="material-icons text-red-500">picture_as_pdf</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{attachment.name || 'PDF Document'}</div>
                                <div className="text-xs text-gray-500">
                                    PDF • {formatFileSize(attachment.size)}
                                </div>
                            </div>
                            <span className="material-icons text-gray-400 text-sm">open_in_new</span>
                        </div>
                    )}
                    {isImage ? (
                        <img
                            src={attachment.url || attachment.fileURL}
                            alt={attachment.name || 'Image'}
                            className="max-w-full max-h-48 rounded-lg hover:opacity-90 transition-opacity"
                        />
                    ) : (
                        <div className="flex items-center gap-3">
                            <span className="material-icons text-4xl text-gray-500">
                                {getFileIcon(attachment.type)}
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{attachment.name || 'File'}</div>
                                <div className="text-xs text-gray-500">
                                    {attachment.type.split('/')[1] || 'File'} • {formatFileSize(attachment.size)}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(e, attachment);
                        }}
                        className="bg-white/90 p-2 rounded-full shadow-md hover:bg-white transition-colors"
                        title="Download"
                    >
                        <span className="material-icons text-gray-800 text-sm">download</span>
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-2`}>
            <div className={`max-w-[85%] rounded-2xl shadow-sm ${mine ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none border border-gray-100'}`}>
                {/* Message Content */}
                {isEncryptedMsg ? (
                    <div className={`p-3 flex items-center gap-2 ${mine ? 'text-indigo-100' : 'text-orange-500'}`}>
                        <span className="material-icons text-xs">lock</span>
                        <span className="italic text-xs">Encrypted Message</span>
                    </div>
                ) : (
                    content && <div className="p-3 text-sm whitespace-pre-wrap break-words">{content}</div>
                )}

                {/* Attachments */}
                {m.attachments?.map((attachment, index) => (
                    <div key={index} className="mb-2">
                        {renderAttachmentPreview(attachment)}
                    </div>
                ))}

                {/* Timestamp */}
                <div className={`text-[10px] mt-1 text-right ${mine ? 'text-white/70' : 'text-gray-400'}`}>
                    {dayjs(m.createdAt).format('HH:mm')}
                </div>
            </div>

            {/* Attachment Viewer Modal */}
            {viewingAttachment && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setViewingAttachment(null)}>
                    <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b flex justify-between items-center">
                            <div className="font-medium">{viewingAttachment.name || 'Attachment'}</div>
                            <button
                                onClick={() => setViewingAttachment(null)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                <span className="material-icons">close</span>
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                            {viewingAttachment.type.startsWith('image/') ? (
                                <img
                                    src={viewingAttachment.url || viewingAttachment.fileURL}
                                    alt={viewingAttachment.name || 'Image'}
                                    className="max-h-[70vh] max-w-full object-contain"
                                />
                            ) : viewingAttachment.type.startsWith('video/') ? (
                                <video
                                    src={viewingAttachment.url || viewingAttachment.fileURL}
                                    controls
                                    className="max-h-[70vh] max-w-full"
                                >
                                    Your browser does not support the video tag.
                                </video>
                            ) : viewingAttachment.type.startsWith('audio/') ? (
                                <div className="w-full max-w-md p-6">
                                    <div className="flex flex-col items-center gap-4">
                                        <span className="material-icons text-6xl text-indigo-500">
                                            {getFileIcon(viewingAttachment.type)}
                                        </span>
                                        <div className="text-lg font-medium">{viewingAttachment.name || 'Audio File'}</div>
                                        <audio
                                            src={viewingAttachment.url || viewingAttachment.fileURL}
                                            controls
                                            className="w-full mt-4"
                                        >
                                            Your browser does not support the audio element.
                                        </audio>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center p-8 max-w-md">
                                    <span className="material-icons text-6xl text-indigo-400 mb-4">
                                        {getFileIcon(viewingAttachment.type)}
                                    </span>
                                    <div className="text-lg font-medium mb-2">{viewingAttachment.name || 'File'}</div>
                                    <div className="text-sm text-gray-600 mb-6">
                                        {viewingAttachment.type} • {formatFileSize(viewingAttachment.size)}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t flex justify-end gap-2">
                            <button
                                onClick={(e) => handleDownload(e, viewingAttachment)}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors"
                            >
                                <span className="material-icons text-sm">download</span>
                                Download
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

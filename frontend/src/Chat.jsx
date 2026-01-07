import React, { useEffect, useRef, useState, useMemo } from 'react'
import EmojiPicker from 'emoji-picker-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useStore } from './store'
import { createSocket } from './socket'
import NewChatModal from './NewChatModal'
import CallPage from './CallPage'
import AddMemberModal from './AddMemberModal'
import { useNavigate } from 'react-router-dom'

// E2EE removed - using only backend AES-256 encryption
import rtcConfig from './iceConfig'
import { INCOMING_RINGTONE, OUTGOING_RINGTONE } from './assets'

dayjs.extend(relativeTime)

import API_URL from './config';

const API = API_URL;

import { encryptFrame, decryptFrame } from './utils/mediaE2EE';


import VideoTile from './components/chat/VideoTile'
import CallOverlay from './components/chat/CallOverlay'
import IncomingCallModal from './components/chat/IncomingCallModal'
import MembersModal from './components/chat/MembersModal'
import MessageInfoModal from './components/chat/MessageInfoModal'


export default function Chat() {
  const { token, setToken, user, setUser, conversations, setConversations, activeId, setActiveId, messages, setMessages, pushMessage, updateMessage, replaceTempMessage, removeMessage, logout, profileOpen, setProfileOpen } = useStore()
  console.log('Chat Component Rendered. User:', user);
  const [socket, setSocket] = useState(null)
  const [typingUsers, setTypingUsers] = useState({})
  const [openNew, setOpenNew] = useState(false)
  const [selectedMessages, setSelectedMessages] = useState(new Set())
  const [toast, setToast] = useState(null)
  const [centerNotification, setCenterNotification] = useState(null)
  const [viewMode, setViewMode] = useState('chats') // 'chats' or 'calls'
  const [callHistory, setCallHistory] = useState([])
  const [unreadCallCount, setUnreadCallCount] = useState(0)
  const nav = useNavigate()
  const [showMembers, setShowMembers] = useState(false)
  const [infoMsg, setInfoMsg] = useState(null)
  const [incomingCall, setIncomingCall] = useState(null)
  const [currentCall, setCurrentCall] = useState(null)
  // E2EE removed - no longer need to cache user keys
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState([])
  const peerConnectionsRef = useRef(new Map())
  const localStreamRef = useRef(null)
  const socketRef = useRef(null)
  const currentCallRef = useRef(null)
  const outgoingTimeoutRef = useRef(null)
  const remoteStreamCleanupsRef = useRef(new Map())
  const iceDisconnectTimeoutsRef = useRef(new Map())
  const [isMicOn, setIsMicOn] = useState(true)
  const [isCameraOn, setIsCameraOn] = useState(true)
  const [localScreenStream, setLocalScreenStream] = useState(null)
  const localScreenStreamRef = useRef(null)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [participantStates, setParticipantStates] = useState({})
  const [enlargedImage, setEnlargedImage] = useState(null)
  const [isCallAccepted, setIsCallAccepted] = useState(false)
  const incomingAudioRef = useRef(new Audio(INCOMING_RINGTONE))
  const outgoingAudioRef = useRef(new Audio(OUTGOING_RINGTONE))

  // Configure Audio Refs
  useEffect(() => {
    incomingAudioRef.current.loop = true
    outgoingAudioRef.current.loop = true
    return () => {
      incomingAudioRef.current.pause()
      outgoingAudioRef.current.pause()
    }
  }, [])

  // Ringtone Logic
  useEffect(() => {
    // Incoming Ringtone
    if (incomingCall && !currentCall) {
      incomingAudioRef.current.currentTime = 0
      incomingAudioRef.current.play().catch(e => console.warn('Audio play failed', e))
    } else {
      incomingAudioRef.current.pause()
      incomingAudioRef.current.currentTime = 0
    }

    // Outgoing Ringtone (Ringback)
    // Play only if we are in a call, it's not accepted yet, and WE initiated it (or someone else did but we are waiting?)
    // Actually, currentCall is set for both caller and callee (after accept).
    // Caller: currentCall set on start. isCallAccepted false. -> Play Ringback.
    // Callee: incomingCall set. Ringtone plays. Then Accept -> currentCall set. isCallAccepted true (immediately). -> No Ringback.
    if (currentCall && !isCallAccepted) {
      // Only play ringback if I am the caller
      if (currentCall.from?._id === user?._id || String(currentCall.from) === String(user?._id)) {
        outgoingAudioRef.current.currentTime = 0
        outgoingAudioRef.current.play().catch(e => console.warn('Audio play failed', e))
      }
    } else {
      outgoingAudioRef.current.pause()
      outgoingAudioRef.current.currentTime = 0
    }
  }, [incomingCall, currentCall, isCallAccepted, user?._id])

  // Persist current call state to localStorage for browser refresh support
  useEffect(() => {
    if (currentCall) {
      localStorage.setItem('active_call', JSON.stringify({
        call: currentCall,
        isAccepted: isCallAccepted,
        timestamp: Date.now()
      }));
    } else {
      localStorage.removeItem('active_call');
    }
  }, [currentCall, isCallAccepted]);

  // CONNECTION TIMEOUT: If call validly accepted but no connection after 15s, end it.
  useEffect(() => {
    let timer;
    if (currentCall && isCallAccepted && remoteStreams.length === 0) {
      timer = setTimeout(() => {
        console.warn("Connection timeout - no remote streams after 30s");
        setToast({
          id: Date.now().toString(),
          title: 'Connection Failed',
          message: 'Could not establish connection. Please try again.',
          type: 'error'
        });
        endCall();
      }, 30000); // Increased to 30s for stability
    }
    return () => clearTimeout(timer);
  }, [currentCall, isCallAccepted, remoteStreams.length]);

  // Call timeout logic (15 seconds ringing for caller)
  useEffect(() => {
    // If no call, or incoming call (we haven't picked up yet), or call is accepted, or we have remote streams (connected)
    // then we don't need the "no answer" timeout.
    if (!currentCall || incomingCall || isCallAccepted || remoteStreams.length > 0) {
      if (outgoingTimeoutRef.current) {
        clearTimeout(outgoingTimeoutRef.current)
        outgoingTimeoutRef.current = null
      }
      return
    }

    // Identify if we initiated the call (we are the caller)
    // currentCall.fromUserId matches our ID?
    // Actually currentCall object usually has { callId, conversationId, type, ... }
    // We assume if we have currentCall and !incomingCall and !isCallAccepted, we are dialing.
    // Ensure we are the caller to show timeout message?
    // If we received the call and accepted, isCallAccepted should be true.
    // If we dialed, we are waiting.

    // Safety: Only run timeout if we are outgoing. 
    // Usually 'incomingCall' state handles the UI for receiver. 
    // currentCall is set when we start call (caller) OR accept call (receiver).
    // If receiver accepts, isCallAccepted -> true immediately.
    // So this timeout primarily affects Caller waiting for answer.

    if (!outgoingTimeoutRef.current) {
      outgoingTimeoutRef.current = setTimeout(() => {
        // If still not accepted and no streams
        let calleeName = 'User';
        const conv = conversations.find(c => c._id === currentCall.conversationId);
        if (conv) {
          if (conv.type === 'group') {
            calleeName = conv.name || 'Group Member';
          } else {
            const other = conv.members?.find(m => String(m._id) !== String(user?._id));
            if (other && other.username) calleeName = other.username;
          }
        }

        setCenterNotification(`"${calleeName}" didn't pick the call. Try again`);
        setTimeout(() => setCenterNotification(null), 5000);
        endCall();
      }, 25000); // Increased to 25s for ringing timeout
    }

    return () => {
      if (outgoingTimeoutRef.current) {
        clearTimeout(outgoingTimeoutRef.current)
        outgoingTimeoutRef.current = null
      }
    }
  }, [currentCall, incomingCall, isCallAccepted, remoteStreams, user?._id, conversations]);

  const handleSaveEdit = async () => {
    if (!editingMessageId || !editingMessageContent.trim()) return

    try {
      const res = await fetch(`${API}/api/messages/${editingMessageId}`, {
        credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: editingMessageContent })
      })
      if (res.ok) {
        useStore.getState().updateMessage(activeId, editingMessageId, { content: editingMessageContent, editedAt: new Date().toISOString() })
        setEditingMessageId(null)
        setEditingMessageContent('')
      } else {
        alert('Failed to edit message')
      }
    } catch (e) {
      console.error('Error editing message:', e)
      alert('Failed to edit message')
    }
  }

  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditingMessageContent('')
  }

  // Top search state
  const [topSearchQuery, setTopSearchQuery] = useState('')
  const [topSearchResults, setTopSearchResults] = useState([])
  const [showTopSearch, setShowTopSearch] = useState(false)

  const removeRemotePeer = (peerId) => {
    if (!peerId) return
    const key = String(peerId)

    const cleanup = remoteStreamCleanupsRef.current.get(key)
    if (cleanup) {
      try { cleanup() } catch (err) { console.warn('Remote stream cleanup failed', err) }
      remoteStreamCleanupsRef.current.delete(key)
    }

    const pc = peerConnectionsRef.current.get(key)
    if (pc) {
      try {
        pc.ontrack = null
        pc.onicecandidate = null
        pc.onnegotiationneeded = null
        pc.onconnectionstatechange = null
        pc.close()
      } catch (err) {
        console.warn('Peer connection close failed', err)
      }
      peerConnectionsRef.current.delete(key)
    }

    setRemoteStreams(prev => {
      const remaining = prev.filter(s => String(s.userId) !== key)
      // AUTO DISCONNECT: If this was a 1:1 call and the peer left, or if no one is left in a group, end our call too
      if (remaining.length === 0 && currentCallRef.current) {
        console.log(`🏁 No participants left (after ${key} left). Ending call for current user.`);
        cleanupCall()
      }
      return remaining
    })
  }

  const registerRemoteStream = (peerId, stream) => {
    if (!peerId || !stream) return
    const key = String(peerId)

    // Remove previous listeners if we already had a stream for this peer
    const existingCleanup = remoteStreamCleanupsRef.current.get(key)
    if (existingCleanup) {
      try { existingCleanup() } catch (err) { console.warn('Cleanup removal failed', err) }
    }

    const handleTrackEnded = () => {
      const tracks = stream.getTracks()
      const allEnded = tracks.length === 0 || tracks.every(track => track.readyState === 'ended')
      if (allEnded) {
        removeRemotePeer(key)
      }
    }

    stream.getTracks().forEach(track => {
      track.addEventListener('ended', handleTrackEnded)
    })

    remoteStreamCleanupsRef.current.set(key, () => {
      stream.getTracks().forEach(track => {
        track.removeEventListener('ended', handleTrackEnded)
      })
    })
  }

  useEffect(() => {
    currentCallRef.current = currentCall
  }, [currentCall])

  // E2EE removed - no longer need to fetch user keys

  // Force macOS (and browsers) to ask for microphone permission once
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        console.log('Microphone allowed')
        // We only needed permission; stop tracks immediately
        stream.getTracks().forEach(t => t.stop())
      })
      .catch((err) => {
        console.error('Microphone denied', err)
      })
  }, [])

  // Top search logic
  useEffect(() => {
    if (!user || !topSearchQuery.trim()) {
      setTopSearchResults([])
      setShowTopSearch(false)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' })
        const list = await r.json()
        const lower = topSearchQuery.toLowerCase()
        const matches = list.filter(u =>
          String(u._id) !== String(user._id) && (
            u.username.toLowerCase().includes(lower) ||
            (u.email && u.email.toLowerCase().includes(lower))
          )
        ).slice(0, 5)
        setTopSearchResults(matches)
        setShowTopSearch(true)
      } catch (e) {
        console.error(e)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [topSearchQuery, user?._id])

  useEffect(() => {
    (async () => {
      if (!token) return
      // validate token and get user
      try {
        const meRes = await fetch(`${API}/api/auth/me`, {
          credentials: 'include',
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })

        if (!meRes.ok) { logout(); return }
        const me = await meRes.json()
        setUser(me)
        setProfileOpen(false)

        // AES-256 encryption is handled by backend - no frontend encryption needed

        // Restore user status from localStorage
        const savedStatus = localStorage.getItem('userStatus')
        if (savedStatus && savedStatus !== 'in_call' && (savedStatus === 'online' || savedStatus === 'away')) {
          fetch(`${API}/api/users/status`, {
            credentials: 'include',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ status: savedStatus })
          }).catch(err => console.error('Failed to restore status:', err))
        }
      } catch (e) {
        console.error('Failed to load current user', e)
        logout()
        return
      }
      const s = createSocket(token)
      setSocket(s)
      socketRef.current = s

      s.on('message_new', (msg) => {
        // Backend sends either:
        //  - message.conversationId (string UUID), or
        //  - legacy message.conversation (id or populated object)
        const rawConv =
          msg?.conversation?._id ||
          msg?.conversation ||
          msg?.conversationId

        if (!rawConv || String(rawConv) === 'undefined' || String(rawConv) === 'null') {
          console.warn('message_new without valid conversation id, skipping', msg)
          return
        }

        const convId = String(rawConv)
        const state = useStore.getState()
        const myId = state.user?._id ? String(state.user._id) : ''
        const senderId = String(msg.sender?._id || msg.sender)

        if (senderId === myId && msg.tempId) {
          replaceTempMessage(convId, msg.tempId, msg)
        } else {
          pushMessage(convId, msg)
        }

        // Check if conversation exists in state, if not fetch it (it might have been hidden/deleted)
        const conversationExists = state.conversations.some(c => c._id === convId)
        if (!conversationExists) {
          fetch(`${API}/api/conversations/${convId}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` }
          })
            .then(r => r.ok ? r.json() : null)
            .then(newConv => {
              if (newConv) {
                setConversations(prev => {
                  // Double check to avoid duplicates
                  if (prev.find(c => c._id === newConv._id)) return prev
                  return [newConv, ...prev]
                })
                // Join the room if not already joined (though socket.on('conversation_created') handles this usually, 
                // but for reappearing chats we might need it)
                s.emit('join_conversation', convId)
              }
            })
            .catch(console.error)
        }

        // Update lastMessageAt so lists can sort by recent activity
        setConversations(cs => cs.map(c => c._id === convId ? { ...c, lastMessageAt: msg.createdAt || c.lastMessageAt || new Date().toISOString() } : c))

        const isFromMe = senderId === myId
        const isActive = String(state.activeId || '') === convId

        console.log('message_new', msg._id, 'conv:', convId, 'fromMe:', isFromMe, 'active:', isActive)

        // Increment unread count if message is not from me and conversation is not active
        if (!isFromMe && !isActive) {
          console.log('Incrementing unread for', convId)
          state.incrementUnread?.(convId)
          const conv = (state.conversations || []).find(c => String(c._id) === convId)
          const other = conv?.type === 'group'
            ? null
            : (conv?.members || []).find(m => String(m._id) !== myId)
          const title = conv
            ? (conv.type === 'group'
              ? (conv.name || 'Group')
              : (other?.username || 'Direct'))
            : 'New message'

          // Backend already decrypts AES-256, use content as-is
          let notifContent = msg.content || 'New message'

          state.pushNotification?.({
            id: String(msg._id || msg.tempId || `${convId}-${Date.now()}`),
            conversationId: convId,
            title,
            message: notifContent,
            from: msg.sender?.username || other?.username || 'Someone',
            createdAt: msg.createdAt,
          })
        }

        if (!isFromMe) {
          s.emit('message_delivered', { messageId: msg._id })
          // If we are currently looking at this conversation, mark it as seen immediately
          if (isActive) {
            console.log('👀 Automarking seen for active conversation:', convId)
            s.emit('message_seen', { conversationId: convId })
          }
        }
      })
      s.on('message_update', ({ messageId, deliveredTo, seenBy }) => {
        console.log('message_update', messageId, deliveredTo?.length, seenBy?.length)
        const state = useStore.getState()
        const convId = Object.keys(state.messages).find(cid => (state.messages[cid] || []).some(m => m._id === messageId))
        if (convId) state.updateMessage(convId, messageId, { deliveredTo, seenBy })
      })
      s.on('message_edited', ({ messageId, content, editedAt }) => {
        const state = useStore.getState()
        const convId = Object.keys(state.messages).find(cid => (state.messages[cid] || []).some(m => m._id === messageId))
        if (convId) state.updateMessage(convId, messageId, { content, editedAt })
      })
      s.on('message_deleted', ({ messageId, conversationId }) => {
        removeMessage(conversationId, messageId)
        setSelectedMessages(prev => {
          const next = new Set(prev)
          next.delete(messageId)
          return next
        })
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

      // NOTE: user_online/user_offline are replaced by user_status_changed

      // Listen for new conversations created by other users
      s.on('conversation_created', async (conversation) => {
        console.log('New conversation created:', conversation)
        // Add the new conversation to the list if not already present
        setConversations(cs => {
          const exists = cs.find(c => c._id === conversation._id)
          if (exists) return cs
          // Join the conversation room
          s.emit('join_conversation', conversation._id)
          return [conversation, ...cs]
        })
      })

      // Listen for conversation deletions
      s.on('conversation_deleted', ({ conversationId }) => {
        console.log('Conversation deleted:', conversationId)
        setConversations(cs => cs.filter(c => c._id !== conversationId))
        // If the deleted conversation was active, clear it
        if (activeId === conversationId) {
          setActiveId(null)
        }
      })

      s.on('call_incoming', (payload) => {
        console.log('Incoming call:', payload)
        if (!payload) return
        if (currentCallRef.current) return
        setIncomingCall(payload)
      })

      // Listen for user key updates (E2EE)
      s.on('user_key_update', ({ userId, publicKey }) => {
        console.log(`Received key update for user ${userId}`)
        setConversations(prevConvs => prevConvs.map(conv => ({
          ...conv,
          members: conv.members?.map(m =>
            String(m._id) === String(userId)
              ? { ...m, publicKey }
              : m
          )
        })))
      })

      // Listen for user status changes
      s.on('user_status_changed', ({ userId, status, lastSeenAt }) => {
        console.log(`User ${userId} status changed to ${status}`)

        // Update conversations to reflect new status
        setConversations(prevConvs => prevConvs.map(conv => ({
          ...conv,
          members: conv.members?.map(m =>
            String(m._id) === String(userId)
              ? { ...m, status, lastSeenAt: new Date(lastSeenAt) }
              : m
          )
        })))

        // Update user object if it's the current user
        const currentUser = useStore.getState().user
        if (currentUser && String(userId) === String(currentUser._id)) {
          setUser(prev => ({ ...prev, status }))
        }
      })

      // Listen for member removal
      s.on('member_removed', ({ conversationId, userId }) => {
        console.log(`Member ${userId} removed from ${conversationId}`);
        // If I was removed
        const currentUserId = useStore.getState().user?._id;
        if (String(userId) === String(currentUserId)) {
          setConversations(cs => cs.filter(c => c._id !== conversationId));
          if (activeId === conversationId) {
            setActiveId(null);
            setInfoMsg(null); // Clear any modals
            alert('You have been removed from this group.');
          }
        }
        // Otherwise, just remove them from the conversation members
        else {
          setConversations(prevConvs => prevConvs.map(conv =>
            conv._id === conversationId
              ? { ...conv, members: conv.members.filter(m => String(m._id) !== String(userId)) }
              : conv
          ));
        }
      })

      // Listen for new call history (missed/unanswered calls)
      s.on('new_call_history', ({ callId, status }) => {
        console.log('New call history:', callId, status)
        // Immediately increment unread count
        setUnreadCallCount(prev => prev + 1)
        // Optionally refresh call history if on Calls tab
        if (viewMode === 'calls') {
          fetch(`${API}/api/calls`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` }
          })
            .then(res => res.json())
            .then(data => setCallHistory(Array.isArray(data) ? data : []))
            .catch(err => console.error('Failed to refresh call history:', err))
        }
      })

      s.on('call_started', async (payload) => {
        if (!payload) return
        console.log('Call started (receiver/joiner side):', payload)
        currentCallRef.current = payload
        setCurrentCall(payload)
        setIsCallAccepted(false) // Reset accepted state for new call
        setIsMicOn(true)
        setIsCameraOn(payload.kind === 'video')
        setIsScreenSharing(false)
        await ensureLocalStream(payload.kind)
      })

      s.on('call_existing_participants', async ({ callId, conversationId, userIds }) => {
        if (!callId || !Array.isArray(userIds)) return
        const currentUser = useStore.getState().user
        if (!currentUser?._id) {
          console.warn('Skipping call_existing_participants: No user in store')
          return
        }

        const call = currentCallRef.current || { callId, conversationId, kind: 'audio' }
        const myId = String(currentUser._id)
        console.log(`📞 [SIGNAL] call_existing_participants: ${userIds.length} peers. MyID: ${myId}`)
        await ensureLocalStream(call.kind)
        console.log(`Existing participants for call ${callId}:`, userIds)
        for (const uid of userIds) {
          const peerId = String(uid)
          if (peerId === myId) continue

          console.log(`📡 Adding existing participant: ${peerId}`)
          const pc = getOrCreatePeerConnection(callId, peerId)
          if (pc.signalingState === 'stable' && localStreamRef.current) {
            console.log(`🔄 Triggering negotiation for existing peer ${peerId}`)
            setTimeout(() => {
              if (pc.onnegotiationneeded) pc.onnegotiationneeded()
            }, 100)
          }
        }

        setIsCallAccepted(true)

        // Also emit my state to existing participants
        if (socketRef.current) {
          let micOff = false
          let cameraOff = false
          if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0]
            if (audioTrack) micOff = !audioTrack.enabled
            const videoTrack = localStreamRef.current.getVideoTracks()[0]
            if (videoTrack) cameraOff = !videoTrack.enabled
          }
          socketRef.current.emit('call_participant_state', {
            callId,
            isMicOff: micOff,
            isCameraOff: cameraOff
          })
        }
      })

      s.on('call_peer_accepted', async ({ callId, conversationId, userId }) => {
        if (!callId || !userId) return
        const currentUser = useStore.getState().user
        if (!currentUser?._id) {
          console.warn('Skipping call_peer_accepted: No user in store')
          return
        }
        const myId = String(currentUser._id)
        console.log(`📞 [SIGNAL] call_peer_accepted from ${userId}. MyID: ${myId}`)
        if (String(userId) === myId) return

        setIsCallAccepted(true) // Call connected (someone picked up)

        // Stop ringing immediately
        if (outgoingAudioRef.current) {
          outgoingAudioRef.current.pause();
          outgoingAudioRef.current.currentTime = 0;
        }

        const call = currentCallRef.current || { callId, conversationId, kind: 'audio' }
        await ensureLocalStream(call.kind)
        const peerId = String(userId)
        console.log(`Peer ${peerId} accepted call ${callId}`)
        const pc = getOrCreatePeerConnection(callId, peerId)
        // Initialize negotiation state for new PC
        pc._isNegotiating = false;
        pc._negotiationTimeout = null;

        // Broadcast my state to the new peer
        const freshUser = useStore.getState().user
        if (freshUser?._id && socketRef.current) {
          let micOff = !isMicOn
          let cameraOff = !isCameraOn

          if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0]
            if (audioTrack) micOff = !audioTrack.enabled
            const videoTrack = localStreamRef.current.getVideoTracks()[0]
            if (videoTrack) cameraOff = !videoTrack.enabled
          }

          socketRef.current.emit('call_participant_state', {
            callId,
            isMicOff: micOff,
            isCameraOff: cameraOff
          })
        }
      })

      s.on('call_signal', async ({ callId, fromUserId, data }) => {
        if (!callId || !fromUserId || !data) return
        const peerId = String(fromUserId)
        const currentUser = useStore.getState().user
        const myId = currentUser?._id ? String(currentUser._id) : 'unknown'

        console.log(`📞 [SIGNAL] call_signal from ${peerId} (type: ${data.type || (data.candidate ? 'candidate' : 'unknown')}). MyID: ${myId}`)

        const call = currentCallRef.current || { callId, kind: 'audio' }
        if (!call) return

        // CRITICAL: Create peer connection FIRST, then ensure local stream
        // This ensures tracks are added correctly when stream is created
        const pc = getOrCreatePeerConnection(callId, peerId)
        await ensureLocalStream(call.kind)

        // Double-check: if local stream exists but wasn't added to this PC, add it now
        if (localStreamRef.current) {
          const existingTrackIds = new Set()
          pc.getSenders().forEach(sender => {
            if (sender.track) existingTrackIds.add(sender.track.id)
          })

          localStreamRef.current.getTracks().forEach(track => {
            if (!existingTrackIds.has(track.id)) {
              console.log(`  🔧 Adding missing ${track.kind} track to PC for ${peerId}`)
              pc.addTrack(track, localStreamRef.current)
            }
          })
        }

        try {
          if (data.type === 'offer' && data.sdp) {
            console.log(`📥 Received offer from ${peerId}, current state: ${pc.signalingState}`)

            const currentUser = useStore.getState().user
            const myId = currentUser?._id ? String(currentUser._id) : ''
            const isPolite = myId < peerId // Simple tie-breaker for glare

            // Handle offer glare FIRST (both sides sent offers simultaneously)
            // In a polite pattern, ONLY the polite side rolls back.
            const isGlare = pc.signalingState === 'have-local-offer' || pc.signalingState !== 'stable'

            if (isGlare) {
              if (!isPolite) {
                console.log(`✋ Impolite peer ${myId} ignoring offer from ${peerId} (signaling state: ${pc.signalingState})`)
                return
              }
              console.log(`🔄 Polite peer ${myId} rolling back for ${peerId} (signaling state: ${pc.signalingState})`)
              try {
                await pc.setLocalDescription({ type: 'rollback' })
              } catch (e) {
                console.warn('❌ Rollback failed', e)
                return
              }
            }

            // RULE 1: Only answer an offer ONCE - must be in "stable" state (after potential rollback)
            if (pc.signalingState !== 'stable') {
              console.warn(`⚠️ Skipping offer, wrong state: ${pc.signalingState} (expected: stable)`)
              return
            }

            // RULE 2: Set remote description (offer) - state must be "stable"
            if (pc.signalingState !== 'stable') {
              console.warn(`⚠️ Cannot set remote offer, state is ${pc.signalingState} (expected: stable)`)
              return
            }

            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
            console.log(`✅ Set remote description (offer) for ${peerId}, new state: ${pc.signalingState}`)

            // Verify state transition
            if (pc.signalingState !== 'have-remote-offer') {
              console.error(`❌ Invalid state after setRemoteDescription: ${pc.signalingState} (expected: have-remote-offer)`)
              return
            }

            // Flush any queued ICE candidates
            if (pc._flushIceCandidates) {
              await pc._flushIceCandidates()
            }

            // RULE 3: Create answer - state must be "have-remote-offer"
            if (pc.signalingState !== 'have-remote-offer') {
              console.warn(`⚠️ Cannot create answer, state is ${pc.signalingState} (expected: have-remote-offer)`)
              return
            }

            const answer = await pc.createAnswer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true
            })

            // RULE 4: Set local description (answer) - state must still be "have-remote-offer"
            if (pc.signalingState !== 'have-remote-offer') {
              console.warn(`⚠️ Cannot set local answer, state changed to ${pc.signalingState} (expected: have-remote-offer)`)
              return
            }

            try {
              await pc.setLocalDescription(answer)
              console.log(`✅ Created and set answer for ${peerId}, final state: ${pc.signalingState}`)
            } catch (e) {
              if (e.name === 'InvalidStateError' || e.name === 'OperationError') {
                console.warn(`⚠️ Failed to set local answer for ${peerId} due to state change (${pc.signalingState}), ignoring`, e.message)
                return
              }
              throw e
            }

            if (socketRef.current) {
              socketRef.current.emit('call_signal', {
                callId,
                toUserId: peerId,
                data: { type: 'answer', sdp: answer.sdp },
              })
            }
          } else if (data.type === 'answer' && data.sdp) {
            console.log(`📥 Received answer from ${peerId}, current state: ${pc.signalingState}`)

            // RULE: Only set answer if we're in "have-local-offer" state
            if (pc.signalingState === 'closed') {
              console.warn(`⚠️ Cannot handle answer, connection closed for ${peerId}`)
              return
            }

            // CRITICAL: Double-check state before processing (race condition protection)
            if (pc.signalingState !== 'have-local-offer') {
              console.warn(`⚠️ Skipping answer, wrong state: ${pc.signalingState} (expected: have-local-offer)`)
              return
            }

            // Check if we already have a remote description (another answer was processed)
            if (pc.remoteDescription && pc.remoteDescription.type === 'answer') {
              console.warn(`⚠️ Answer already processed for ${peerId}, ignoring duplicate`)
              return
            }

            try {
              // CRITICAL: Re-check state right before setRemoteDescription (race condition protection)
              if (pc.signalingState !== 'have-local-offer') {
                console.warn(`⚠️ State changed before setRemoteDescription for ${peerId}, skipping`)
                return
              }

              await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
              console.log(`✅ Set remote description (answer) for ${peerId}, new state: ${pc.signalingState}`)

              // Flush any queued ICE candidates
              if (pc._flushIceCandidates) {
                await pc._flushIceCandidates()
              }
            } catch (e) {
              // Handle state errors gracefully (race condition - another answer processed first)
              if (e.name === 'InvalidStateError' && pc.signalingState === 'stable') {
                console.warn(`⚠️ Answer already processed for ${peerId} (race condition), ignoring`)
                return
              }

              // Handle SSL role conflict - this can happen if both sides sent offers
              if (e.name === 'InvalidAccessError' && e.message.includes('SSL role')) {
                console.warn(`⚠️ SSL role conflict for ${peerId}, will retry negotiation`)
                return
              }

              // Only log unexpected errors
              if (pc.signalingState !== 'stable') {
                console.error('❌ Error handling call signal:', e)
              } else {
                console.warn(`⚠️ Answer processing error (likely already processed):`, e.message)
              }
            }
          } else if (data.candidate) {
            // RULE 5: ICE candidates only after remote description is set
            try {
              if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
                console.log(`✅ Added ICE candidate from ${peerId}`)
              } else {
                // Queue the candidate if remote description isn't ready
                if (!pc._iceCandidateQueue) {
                  pc._iceCandidateQueue = []
                }
                pc._iceCandidateQueue.push(data.candidate)
                console.log(`⏳ Queued ICE candidate from ${peerId} (waiting for remote description)`)
              }
            } catch (e) {
              console.warn('⚠️ Error adding ICE candidate:', e)
            }
          }
        } catch (e) {
          console.error('❌ Error handling call signal:', e)
          // Don't throw - allow other signals to process
        }
      })

      s.on('call_ended', () => {
        cleanupCall()
      })

      s.on('call_user_left', ({ callId, userId }) => {
        if (currentCallRef.current?.callId !== callId) return
        removeRemotePeer(userId)
        // Remove from participant states
        setParticipantStates(prev => {
          const next = { ...prev }
          delete next[userId]
          return next
        })
      })

      s.on('call_participant_state', ({ callId, userId, isMicOff, isCameraOff, isScreenSharing }) => {
        if (currentCallRef.current?.callId !== callId) return

        // FAILSAFE: If user explicitly stopped sharing, force clean up their screen stream immediately
        if (isScreenSharing === false) {
          console.log(`🛑 User ${userId} signalled stop sharing - forcing stream cleanup`);
          setRemoteStreams(prev => {
            return prev.filter(rs => {
              // Only check streams for the specific user
              if (String(rs.userId) !== String(userId)) return true;

              // If stream has NO audio tracks, we assume it is the screen share.
              // Since isScreenSharing is FALSE, this stream is STALE.
              const hasAudio = rs.stream.getAudioTracks().length > 0;
              if (!hasAudio) {
                console.log(`  ♻️ Removing stale screen stream ${rs.stream.id} for ${userId}`);
                rs.stream.getTracks().forEach(t => t.stop());
                return false;
              }
              return true;
            });
          });
        }

        setParticipantStates(prev => ({
          ...prev,
          [userId]: {
            ...(prev[userId] || {}),
            isMicOff,
            isCameraOff,
            isScreenSharing: isScreenSharing ?? prev[userId]?.isScreenSharing
          }
        }))
      })

      s.on('call_error', ({ error }) => {
        console.error('Call error:', error)
        setInfoMsg({ type: 'error', msg: `Call error: ${error}` })
        cleanupCall()
      })

      s.on('invited_to_group', ({ conversationId, invitedBy, conversation }) => {
        console.log(`Invited to group by ${invitedBy}`)
        const conv = { _id: conversationId, ...conversation }
        setConversations(prev => {
          const existing = prev.find(c => String(c._id) === String(conversationId))
          if (existing) {
            return prev.map(c => String(c._id) === String(conversationId) ? conv : c)
          }
          return [...prev, conv]
        })
        setToast({ id: Date.now().toString(), title: 'New Group', message: `${invitedBy} added you to a group`, type: 'success' })
      })

      try {
        const res = await fetch(`${API}/api/conversations`, {
          credentials: 'include',
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })

        if (res.status === 304) {
          return
        }

        if (!res.ok) {
          throw new Error(`Failed to load conversations: ${res.status}`)
        }

        const cs = await res.json()
        const filtered = cs.filter(c => !(c.type === 'group' && String(c.name || '').trim().toLowerCase() === 'lobby'))
        setConversations(filtered)

        // Initialize unread counts
        const unreadMap = {}
        filtered.forEach(c => {
          if (c.unreadCount > 0) {
            unreadMap[c._id] = c.unreadCount
          }
          s.emit('join_conversation', c._id)
        })
        useStore.setState({ unreadCounts: unreadMap })
        setActiveId(null)
      } catch (e) {
        console.error('Failed to load conversations', e)
      }
    })()
  }, [token])

  // Fetch call history when viewing calls tab
  useEffect(() => {
    if (viewMode === 'calls' && token) {
      console.log('Fetching call history from:', `${API}/api/calls`)

      // Immediately clear the notification badge for instant UI feedback
      setUnreadCallCount(0)

      // Fetch call history
      fetch(`${API}/api/calls`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          console.log('Call history response status:', res.status)
          return res.json()
        })
        .then(data => {
          console.log('Call history data:', data)
          setCallHistory(Array.isArray(data) ? data : [])
        })
        .catch(err => console.error('Failed to fetch call history:', err))

      // Mark all calls as viewed in the background
      fetch(`${API}/api/calls/mark-all-viewed`, {
        credentials: 'include',
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      })
        .catch(err => console.error('Failed to mark calls as viewed:', err))
    }
  }, [viewMode, token])

  // Fetch unread call count periodically
  useEffect(() => {
    if (!token) return

    const fetchUnreadCount = () => {
      fetch(`${API}/api/calls/unread/count`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          if (res.status === 401) {
            useStore.getState().logout();
            return;
          }
          return res.json();
        })
        .then(data => {
          if (data) setUnreadCallCount(data.count || 0);
        })
        .catch(err => console.error('Failed to fetch unread call count:', err))
    }

    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 30000) // Check every 30 seconds

    return () => clearInterval(interval)
  }, [token])

  useEffect(() => {
    if (!socket || !activeId || !user || !token) return
    socket.emit('join_conversation', activeId)

      ; (async () => {
        const r = await fetch(`${API}/api/messages/${activeId}`, {
          credentials: 'include', headers: { Authorization: `Bearer ${token}` }
        })
        const msgs = await r.json()
        setMessages(activeId, msgs)
        socket.emit('message_seen', { conversationId: activeId })
      })()
    return () => socket.emit('leave_conversation', activeId)
  }, [socket, activeId, token])

  useEffect(() => {
    const unsub = useStore.subscribe((state) => state.notifications, (notifs, prev) => {
      if (notifs && prev && notifs.length > prev.length) {
        setToast(notifs[0])
      }
    })
    return () => unsub()
  }, [])

  if (!token) return null
  if (!user) return <div className="h-screen grid place-items-center text-gray-600">Loading...</div>

  const onLogout = () => { logout(); nav('/login') }

  const getDeletedForMeMap = () => {
    try { return JSON.parse(localStorage.getItem('deletedForMe') || '{}') } catch { return {} }
  }
  const setDeletedForMeMap = (map) => {
    try { localStorage.setItem('deletedForMe', JSON.stringify(map)) } catch { }
  }
  const addDeletedForMe = (convId, ids) => {
    const map = getDeletedForMeMap()
    const existing = new Set((map[convId] || []).map(String))
    ids.forEach(id => existing.add(String(id)))
    map[convId] = [...existing]
    setDeletedForMeMap(map)
  }
  const getDeletedIdsForConv = (convId) => new Set(((getDeletedForMeMap()[convId]) || []).map(String))

  const refreshMessages = async () => {
    if (!socket || !activeId || !user || !token) return
    const r = await fetch(`${API}/api/messages/${activeId}`, {
      credentials: 'include', headers: { Authorization: `Bearer ${token}` }
    })
    const msgs = await r.json()
    const hidden = getDeletedIdsForConv(activeId)
    const filtered = (msgs || []).filter(m => !hidden.has(String(m._id)))
    setMessages(activeId, filtered)
  }

  async function ensureLocalStream(kind) {
    if (localStreamRef.current) return localStreamRef.current
    try {
      const constraints = kind === 'video'
        ? {
          audio: true,
          video: { width: 640, height: 480 }
        }
        : {
          audio: true,
          video: false
        }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // Ensure audio tracks are enabled
      stream.getAudioTracks().forEach(track => {
        track.enabled = true
      })

      console.log('🎤 Local stream created', {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
        kind,
      })

      localStreamRef.current = stream
      setLocalStream(stream)

      // CRITICAL: Add tracks to all existing peer connections
      // This fixes the issue where PC is created before local stream
      peerConnectionsRef.current.forEach((pc, peerId) => {
        const existingTracks = new Set()
        pc.getSenders().forEach(sender => {
          if (sender.track) existingTracks.add(sender.track.id)
        })

        stream.getTracks().forEach(track => {
          if (!existingTracks.has(track.id)) {
            console.log(`  ✅ Adding ${track.kind} track to existing PC for peer ${peerId}`)
            pc.addTrack(track, stream)
          }
        })
      })

      return stream
    } catch (e) {
      console.error('Error getting user media:', e)
      return null
    }
  }

  // RESTORE CALL ON MOUNT (Support Refresh)
  useEffect(() => {
    if (socket && user && !currentCall) {
      const saved = localStorage.getItem('active_call');
      if (saved) {
        try {
          const data = JSON.parse(saved);
          const age = Date.now() - data.timestamp;
          if (age < 30 * 60 * 1000) {
            console.log('🔄 Refresh Re-join:', data.call.callId);
            setCurrentCall(data.call);
            currentCallRef.current = data.call;
            setIsCallAccepted(data.isAccepted);
            if (data.isAccepted) {
              socket.emit('call_accept', { callId: data.call.callId, conversationId: data.call.conversationId });
              ensureLocalStream(data.call.kind);
            }
          }
        } catch (e) {
          localStorage.removeItem('active_call');
        }
      }
    }
  }, [socket, user]);

  function cleanupCall() {
    console.log('🧹 Cleaning up call state')
    localStorage.removeItem('active_call')

    // Stop local streams
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
      setLocalStream(null)
    }
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach(t => t.stop())
      localScreenStreamRef.current = null
      setLocalScreenStream(null)
    }
    setIsScreenSharing(false)
    setIsCameraOn(true)

    peerConnectionsRef.current.forEach((pc) => {
      try { pc.close() } catch (e) { }
    })
    peerConnectionsRef.current.clear()
    remoteStreamCleanupsRef.current.forEach((cleanup) => {
      try { cleanup() } catch (err) { console.warn('Remote stream detach failed', err) }
    })
    remoteStreamCleanupsRef.current.clear()
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
    }
    setLocalStream(null)
    setRemoteStreams([])
    setCurrentCall(null)
    setIncomingCall(null)
    currentCallRef.current = null
    setIsMicOn(true)
    setIsCameraOn(true)
    setIsScreenSharing(false)
    setIsCallAccepted(false)

    // Explicitly kill sounds
    if (incomingAudioRef.current) {
      incomingAudioRef.current.pause()
      incomingAudioRef.current.currentTime = 0
    }
    if (outgoingAudioRef.current) {
      outgoingAudioRef.current.pause()
      outgoingAudioRef.current.currentTime = 0
    }
  }

  function getOrCreatePeerConnection(callId, peerUserId) {
    const key = String(peerUserId)
    let pc = peerConnectionsRef.current.get(key)
    if (pc) return pc

    // Log the configuration being used
    console.log('🔧 Creating RTCPeerConnection with config:', {
      iceServers: rtcConfig.iceServers.length,
      iceTransportPolicy: rtcConfig.iceTransportPolicy,
      turnServers: rtcConfig.iceServers.filter(s => s.urls.toString().includes('turn')).length
    })

    pc = new RTCPeerConnection({ ...rtcConfig, encodedInsertableStreams: true })
    pc._isNegotiating = false
    pc._negotiationTimeout = null
    pc._retryCount = 0 // Track ICE restarts
    peerConnectionsRef.current.set(key, pc)

    pc.onnegotiationneeded = () => {
      // RULE: Never renegotiate on ICE state changes or while disconnected
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        console.log(`⏳ Skipping negotiation for ${key}: ICE state is ${pc.iceConnectionState}`)
        return
      }
      console.log(`Negotiation needed for ${key}, current state: ${pc.signalingState}`)
      attemptNegotiation()
    }

    // Verify TURN is configured
    const turnServers = rtcConfig.iceServers.filter(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls]
      return urls.some(url => url.includes('turn'))
    })
    if (turnServers.length === 0) {
      console.error('❌ WARNING: No TURN servers found in RTCPeerConnection config!')
    } else {
      console.log(`✅ TURN server confirmed in config for ${key}`)
    }

    // Queue for ICE candidates that arrive before remote description
    const iceCandidateQueue = []
    const flushIceCandidates = async () => {
      if (!pc.remoteDescription) return
      while (iceCandidateQueue.length > 0) {
        const candidate = iceCandidateQueue.shift()
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
          console.log(`Queued ICE candidate added for ${key}`)
        } catch (e) {
          console.warn('Error adding queued ICE candidate:', e)
        }
      }
    }

    // Store queue and flush function on the peer connection for access in signal handler
    pc._iceCandidateQueue = iceCandidateQueue
    pc._flushIceCandidates = flushIceCandidates

    // Add local tracks if stream exists, otherwise set up transceivers for receiving
    if (localStreamRef.current) {
      console.log(`🎤 Adding ${localStreamRef.current.getTracks().length} local tracks to PC for ${key}`)
      localStreamRef.current.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStreamRef.current)
        console.log(`  ✅ Added ${track.kind} track (id: ${track.id})`)

        // Step 4: Media E2EE (Sender)
        if (sender.createEncodedStreams) {
          try {
            const streams = sender.createEncodedStreams()
            const transformer = new TransformStream({
              transform: (frame, controller) => {
                // Use window.mediaKey for now (or store.mediaKey)
                const key = window.mediaKey
                frame.data = encryptFrame(frame.data, key)
                controller.enqueue(frame)
              }
            })
            streams.readable.pipeThrough(transformer).pipeTo(streams.writable)
          } catch (e) {
            console.error('E2EE Sender Error:', e)
          }
        }
      })
    } else {
      // Set up transceivers for bidirectional media (sendrecv allows both directions)
      // This ensures we can receive media even if local stream isn't ready yet
      if (pc.getTransceivers().length === 0) {
        console.log(`📡 Setting up transceivers for ${key} (no local stream yet)`)
        try {
          pc.addTransceiver('audio', { direction: 'sendrecv' })
          console.log(`  ✅ Added audio transceiver (sendrecv)`)
        } catch (e) {
          console.warn(`  ⚠️ Failed to add audio transceiver:`, e)
        }
        try {
          pc.addTransceiver('video', { direction: 'sendrecv' })
          console.log(`  ✅ Added video transceiver (sendrecv)`)
        } catch (e) {
          console.warn(`  ⚠️ Failed to add video transceiver:`, e)
        }
      }
    }

    // CRITICAL: Handle incoming remote tracks
    pc.ontrack = (event) => {
      // Step 4: Media E2EE (Receiver)
      if (event.receiver.createEncodedStreams) {
        try {
          const streams = event.receiver.createEncodedStreams()
          const transformer = new TransformStream({
            transform: (frame, controller) => {
              const key = window.mediaKey
              frame.data = decryptFrame(frame.data, key)
              controller.enqueue(frame)
            }
          })
          streams.readable.pipeThrough(transformer).pipeTo(streams.writable)
        } catch (e) {
          console.error('E2EE Receiver Error:', e)
        }
      }

      console.log(`🎥🎥🎥 REMOTE TRACK RECEIVED for ${key}!`, {
        streams: event.streams?.length || 0,
        track: event.track?.kind || 'unknown',
        trackId: event.track?.id,
        trackState: event.track?.readyState,
        transceiver: event.transceiver?.direction
      })

      const stream = event.streams?.[0] || (event.track ? new MediaStream([event.track]) : null)
      if (!stream) {
        console.error(`❌ No stream or track in ontrack event for ${key}`)
        return
      }

      // Enable all tracks & add cleanup listeners
      stream.getTracks().forEach(track => {
        track.enabled = true;

        // CRITICAL: Listen for track ending to clean up (fixes "stuck presenting" issue)
        track.onended = () => {
          console.log(`🏁 Remote track ended: ${track.kind} (${track.id})`);

          // Check if stream is empty (no live tracks)
          const liveTracks = stream.getTracks().filter(t => t.readyState === 'live');
          if (liveTracks.length === 0) {
            console.log(`♻️ Stream ${stream.id} has no live tracks, removing from state.`);
            setRemoteStreams(prev => prev.filter(rs => rs.stream.id !== stream.id));
          } else {
            // Force update to re-render (e.g. screen track removed from mixed stream)
            setRemoteStreams(prev => [...prev]);
          }
        };
      });

      console.log(`✅✅✅ REMOTE STREAM READY for ${key}:`, {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
        totalTracks: stream.getTracks().length
      })

      const uid = key
      setRemoteStreams(prev => {
        // Allow multiple streams from the same user (camera + screen)
        const others = prev.filter(rs => rs.stream.id !== stream.id)
        console.log(`  ✅ Updating remote stream state for ${uid} (stream: ${stream.id}, tracks: ${stream.getTracks().length})`)
        return [...others, { userId: uid, stream, _ts: Date.now() }]
      })
      registerRemoteStream(uid, stream)
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        const candidateStr = event.candidate.candidate
        const candidateType = event.candidate.type || 'unknown'
        // Extract candidate type from the candidate string for better logging
        let typeLabel = 'unknown'
        if (candidateStr.includes('typ host')) typeLabel = 'host (local)'
        else if (candidateStr.includes('typ srflx')) typeLabel = 'srflx (STUN)'
        else if (candidateStr.includes('typ relay')) typeLabel = 'relay (TURN)'
        else if (candidateStr.includes('typ prflx')) typeLabel = 'prflx (peer reflexive)'

        // Extract IP address for TURN verification
        let ipInfo = ''
        if (typeLabel === 'relay (TURN)') {
          const ipMatch = candidateStr.match(/(\d+\.\d+\.\d+\.\d+)/)
          if (ipMatch) {
            ipInfo = ` [IP: ${ipMatch[1]}]`
            if (ipMatch[1] === '3.108.166.72') {
              console.log(`✅✅✅ TURN RELAY CANDIDATE CONFIRMED for ${key} - Using TURN server 3.108.166.72!`)
            }
          }
        }

        console.log(`🔌 ICE candidate for ${key} [${typeLabel}]${ipInfo}:`, candidateStr.substring(0, 80) + '...')

        socketRef.current.emit('call_signal', {
          callId,
          toUserId: key,
          data: { candidate: event.candidate }
        })
      } else if (!event.candidate) {
        console.log(`✅ ICE gathering complete for ${key}`)
        // Log final connection state
        console.log(`📊 Final ICE connection state for ${key}: ${pc.iceConnectionState}`)
        console.log(`📊 Final peer connection state for ${key}: ${pc.connectionState}`)
      }
    }

    pc.onicegatheringstatechange = () => {
      console.log(`ICE gathering state for ${key}:`, pc.iceGatheringState)
    }

    let iceRestartAttempts = 0
    const MAX_ICE_RESTARTS = 3

    const cancelPeerRemoval = (peerKey) => {
      const key = String(peerKey)
      if (iceDisconnectTimeoutsRef.current.has(key)) {
        clearTimeout(iceDisconnectTimeoutsRef.current.get(key))
        iceDisconnectTimeoutsRef.current.delete(key)
        console.log(`✅ Cancelled pending peer removal for ${key}`)
      }
    }

    const schedulePeerRemoval = (peerKey, delayMs, reason = 'connection failure') => {
      const key = String(peerKey)
      // Cancel any existing timeout for this peer first
      cancelPeerRemoval(key)

      const timeout = setTimeout(() => {
        iceDisconnectTimeoutsRef.current.delete(key)

        // Final safety check: if peer is actually connected now, don't remove it
        const currentPC = peerConnectionsRef.current.get(key)
        if (currentPC && (currentPC.iceConnectionState === 'connected' || currentPC.iceConnectionState === 'completed')) {
          console.log(`🛡️ Final check: Peer ${key} is now ${currentPC.iceConnectionState}. Aborting scheduled removal.`)
          return
        }

        console.log(`❌ Removing peer ${key} after ${delayMs}ms due to ${reason}`)
        // Before removing, ensure we stop any potential restart loops
        if (currentPC) currentPC.oniceconnectionstatechange = null
        removeRemotePeer(key)
      }, delayMs)

      iceDisconnectTimeoutsRef.current.set(key, timeout)
      console.log(`🕒 Scheduled peer removal for ${key} in ${delayMs}ms (${reason})`)
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      const stateEmoji = {
        'new': '🆕',
        'checking': '🔍',
        'connected': '✅',
        'completed': '✅',
        'failed': '❌',
        'disconnected': '⚠️',
        'closed': '🔒'
      }
      console.log(`${stateEmoji[state] || '📡'} ICE connection state for ${key}:`, state)

      if (state === 'failed') {
        if (pc._retryCount < 2) {
          pc._retryCount++
          console.warn(`⚠️ ICE failed for ${key}, attempt ${pc._retryCount}/2 to restart...`)
          if (pc.signalingState === 'stable') {
            try {
              pc.restartIce()
              console.log(`📡 Silent ICE restart triggered for ${key}`)
              return
            } catch (e) {
              console.error(`❌ Failed to restart ICE for ${key}:`, e)
            }
          }
        }
        console.error(`❌ ICE connection failed for ${key}. Ending peer session.`)
        cancelPeerRemoval(key)
        schedulePeerRemoval(key, 3000, 'ICE failed state')
      } else if (state === 'disconnected') {
        // TEMPORARY DISCONNECTION: Do NOT destroy peer.
        // Wait 30 seconds for the browser/TURN to silently reconnect.
        console.log(`⚠️ ICE disconnected (temporary) for ${key}. Waiting 30s for recovery...`)
        schedulePeerRemoval(key, 30000, 'ICE recovery timeout')
      } else if (state === 'checking' || state === 'connected' || state === 'completed') {
        // ACTIVE RECOVERY OR STABLE: Cancel removal
        cancelPeerRemoval(key)
        if (state === 'connected' || state === 'completed') {
          console.log(`✅ ICE connection active for ${key}`)
        }
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      const iceState = pc.iceConnectionState
      const signalingState = pc.signalingState

      console.log(`📊 Peer ${key} connection state changed:`, {
        connectionState: state,
        iceConnectionState: iceState,
        signalingState: signalingState
      })

      if (state === 'closed') {
        console.log(`❌ Peer connection closed for ${key}`)
        cancelPeerRemoval(key)
        removeRemotePeer(key)
      } else if (state === 'failed') {
        console.error(`❌ Peer connection FAILED for ${key}.`)
        cancelPeerRemoval(key)
        removeRemotePeer(key)
      } else if (state === 'connected') {
        console.log(`✅✅✅ Peer connection ESTABLISHED for ${key}!`)
        cancelPeerRemoval(key)
      } else if (state === 'disconnected') {
        console.warn(`⚠️ Peer connection disconnected for ${key} (waiting for ICE recovery)`)
      }
    }

    const attemptNegotiation = async () => {
      if (pc._isNegotiating) {
        console.log(`⏳ Negotiation already in progress for ${key}, skipping`)
        return
      }
      pc._isNegotiating = true

      const call = currentCallRef.current
      if (!call || !socketRef.current) {
        console.warn(`⚠️ Cannot negotiate: call or socket missing for ${key}`)
        pc._isNegotiating = false
        return
      }

      // RULE: Only create offer when in "stable" state
      if (pc.signalingState !== 'stable') {
        console.log(`⏳ Waiting for stable state before negotiation for ${key}, current: ${pc.signalingState}`)
        pc._isNegotiating = false
        // Retry after a short delay
        if (pc._negotiationTimeout) clearTimeout(pc._negotiationTimeout)
        pc._negotiationTimeout = setTimeout(() => {
          if (pc.signalingState === 'stable' && !pc._isNegotiating) {
            attemptNegotiation()
          }
        }, 100)
        return
      }

      try {
        // Capture state before creating offer
        const stateBeforeOffer = pc.signalingState

        // RULE: Verify we're still in stable state before creating offer
        if (stateBeforeOffer !== 'stable') {
          console.warn(`⚠️ State changed before offer creation for ${key}: ${stateBeforeOffer}`)
          pc._isNegotiating = false
          return
        }

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: call.kind === 'video'
        })

        // RULE: If state changed during offer creation (e.g. we received a remote offer), abort
        if (pc.signalingState !== 'stable') {
          console.log(`⚠️ State changed during offer creation for ${key}, aborting. New state: ${pc.signalingState}`)
          pc._isNegotiating = false
          return
        }

        // RULE: Set local description only if still in stable state
        if (pc.signalingState !== 'stable') {
          console.warn(`⚠️ Cannot set local description, state is ${pc.signalingState} (expected: stable)`)
          pc._isNegotiating = false
          return
        }

        await pc.setLocalDescription(offer)
        console.log(`✅ Created and set local offer for ${key}, new state: ${pc.signalingState}`)

        // Verify state transition
        if (pc.signalingState !== 'have-local-offer') {
          console.error(`❌ Invalid state after setLocalDescription: ${pc.signalingState} (expected: have-local-offer)`)
          pc._isNegotiating = false
          return
        }

        socketRef.current.emit('call_signal', {
          callId: call.callId,
          toUserId: key,
          data: { type: 'offer', sdp: offer.sdp },
        })
        console.log(`📤 Sent offer to ${key}`)
      } catch (e) {
        // These errors often happen due to races when both sides negotiate.
        // Treat InvalidStateError / OperationError as benign and ignore.
        if (e && (e.name === 'InvalidStateError' || e.name === 'OperationError')) {
          console.warn(`⚠️ Negotiation race ignored for ${key}:`, e.message)
        } else {
          console.error(`❌ Negotiation error for ${key}:`, e)
        }
      } finally {
        pc._isNegotiating = false
      }
    }

    // assigned above pc.addTrack to ensure no lost events

    return pc
  }

  function startCall(kind) {
    if (!socketRef.current || !activeId || !user) {
      console.error('Cannot start call: socket, activeId, or user missing');
      return;
    }
    const conv = conversations.find(c => c._id === activeId);
    if (!conv) {
      console.error('Conversation not found');
      return;
    }

    // Check if any member is already in a call
    const memberInCall = conv.members?.find(m =>
      String(m._id) !== String(user._id) && m.status === 'in_call'
    );

    if (memberInCall) {
      alert(`${memberInCall.username} is currently in another call. Please try again later.`);
      return;
    }

    console.log(`Starting ${kind} call in ${conv.type} conversation`);
    socketRef.current.emit('call_start', { conversationId: activeId, kind });
  }

  async function acceptIncomingCall() {
    if (!incomingCall || !socketRef.current) {
      console.error('Cannot accept call: no incoming call or socket');
      return;
    }
    try {
      const call = incomingCall;
      setIncomingCall(null);
      currentCallRef.current = call;
      setCurrentCall(call);
      setIsCallAccepted(true); // I accepted, so it's accepted
      await ensureLocalStream(call.kind);

      // Stop ringing immediately
      if (incomingAudioRef.current) {
        incomingAudioRef.current.pause();
        incomingAudioRef.current.currentTime = 0;
      }

      socketRef.current.emit('call_accept', { callId: call.callId, conversationId: call.conversationId });
      setIsCameraOn(call.kind === 'video');

      // Emit default state on accept
      socketRef.current.emit('call_participant_state', {
        callId: call.callId,
        isMicOff: false, // Default on
        isCameraOff: call.kind !== 'video', // Default on if video call
        isScreenSharing: false
      })
    } catch (e) {
      console.error('Error accepting call:', e);
      setIncomingCall(null);
    }
  }

  function rejectIncomingCall() {
    if (!incomingCall || !socketRef.current) {
      setIncomingCall(null);
      return;
    }
    try {
      const call = incomingCall;
      socketRef.current.emit('call_end', { callId: call.callId, conversationId: call.conversationId });
      setIncomingCall(null);
      cleanupCall();
    } catch (e) {
      console.error('Error rejecting call:', e);
      setIncomingCall(null);
    }
  }

  function endCall() {
    if (currentCall && socketRef.current) {
      try {
        const conv = conversations.find(c => c._id === currentCall.conversationId);
        if (conv && conv.type === 'group') {
          socketRef.current.emit('call_leave', { callId: currentCall.callId, conversationId: currentCall.conversationId })
        } else {
          socketRef.current.emit('call_end', { callId: currentCall.callId, conversationId: currentCall.conversationId })
        }
      } catch (e) {
        console.error('Error ending call:', e);
      }
    }
    cleanupCall()
  }

  async function toggleMic() {
    const next = !isMicOn
    const stream = localStreamRef.current

    try {
      if (stream) {
        let audioTracks = stream.getAudioTracks()

        if (audioTracks.length === 0 && next) {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          })

          const audioTrack = audioStream.getAudioTracks()[0]
          if (audioTrack) {
            stream.addTrack(audioTrack)
            peerConnectionsRef.current.forEach(pc => {
              const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio')
              if (sender) sender.replaceTrack(audioTrack)
              else pc.addTrack(audioTrack, stream)
            })
            audioTracks = [audioTrack]
          }
        }

        audioTracks.forEach(t => {
          t.enabled = next
        })
      }
    } catch (e) {
      console.error('Error toggling mic', e)
    }

    setIsMicOn(next)

    // Broadcast state to other participants
    if (socketRef.current && currentCallRef.current) {
      socketRef.current.emit('call_participant_state', {
        callId: currentCallRef.current.callId,
        isMicOff: !next,
        isCameraOff: !isCameraOn
      })
    }
  }

  async function toggleCamera() {
    const stream = localStreamRef.current
    const turningOn = !isCameraOn

    // No local stream yet: request full AV stream
    if (!stream) {
      if (!turningOn) {
        setIsCameraOn(false)
        return
      }
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } })
        localStreamRef.current = camStream
        setLocalStream(camStream)
        setIsCameraOn(true)
        // Attach tracks to all existing peer connections
        peerConnectionsRef.current.forEach(pc => {
          camStream.getTracks().forEach(track => {
            const existingSender = pc.getSenders().find(s => s.track && s.track.kind === track.kind)
            if (existingSender) existingSender.replaceTrack(track)
            else pc.addTrack(track, camStream)
          })
        })
      } catch (e) {
        setIsCameraOn(false)
      }
      return
    }

    const videoTracks = stream.getVideoTracks()

    // If we already have a video track, just toggle enabled state
    if (videoTracks.length > 0) {
      videoTracks.forEach(t => { t.enabled = !isCameraOn })
      setIsCameraOn(!isCameraOn)
      return
    }

    // Audio-only stream and user wants to turn camera on: add a new video track
    if (turningOn) {
      try {
        console.log('📽️ Upgrading audio call to video...');
        const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
        const camTrack = camStream.getVideoTracks()[0]
        if (!camTrack) {
          console.error('❌ No camera track found after request');
          return
        }

        console.log(`✅ Camera track obtained: ${camTrack.id}. Adding to stream...`);
        stream.addTrack(camTrack)

        // Force a new MediaStream object to trigger React re-renders in all components
        const newStream = new MediaStream(stream.getTracks());
        localStreamRef.current = newStream;
        setLocalStream(newStream);

        peerConnectionsRef.current.forEach((pc, peerId) => {
          // Find the camera sender: It's the video sender that was either created for the camera
          // or is the first video transceiver created.
          const senders = pc.getSenders();

          // First, identify the screen track ID if we are currently sharing (to avoid picking it)
          const screenTrackId = localScreenStreamRef.current?.getVideoTracks()[0]?.id;

          let cameraSender = senders.find(s =>
            s.track && s.track.kind === 'video' && s.track.id !== screenTrackId
          );

          // If no active camera sender found, try to find a video sender with no track (idle)
          if (!cameraSender) {
            cameraSender = senders.find(s => !s.track && s.track === null && s.dtlsTransport); // Likely the camera transceiver
          }

          if (cameraSender) {
            console.log(`  🔄 Replacing/Setting video track for peer ${peerId}`);
            cameraSender.replaceTrack(camTrack)
          } else {
            console.log(`  ➕ Adding new video track for peer ${peerId}`);
            const sender = pc.addTrack(camTrack, newStream)

            // Step 4: Media E2EE (Sender - Camera Upgrade)
            if (sender.createEncodedStreams) {
              try {
                const streams = sender.createEncodedStreams();
                const transformer = new TransformStream({
                  transform: (frame, controller) => {
                    const key = window.mediaKey;
                    frame.data = encryptFrame(frame.data, key);
                    controller.enqueue(frame);
                  }
                });
                streams.readable.pipeThrough(transformer).pipeTo(streams.writable);
                console.log('  🔒 E2EE Encryption enabled for camera upgrade');
              } catch (e) {
                console.error('  ❌ E2EE Camera Upgrade Sender Error:', e);
              }
            }
          }

          // Trigger negotiation
          if (pc.onnegotiationneeded) {
            console.log(`  🔔 Triggering negotiation for camera upgrade (${peerId})`);
            pc.onnegotiationneeded();
          }
        })

        setIsCameraOn(true)
      } catch (e) {
        console.error('❌ Failed to upgrade call to video:', e)
        setIsCameraOn(false)
      }
    } else {
      setIsCameraOn(false)
    }

    // Broadcast state to other participants
    if (socketRef.current && currentCallRef.current) {
      socketRef.current.emit('call_participant_state', {
        callId: currentCallRef.current.callId,
        isMicOff: !isMicOn,
        isCameraOff: !turningOn
      })
    }
  }

  async function startScreenShare() {
    // SECURITY RULE: getDisplayMedia() can ONLY be called from a direct user click
    // Never call it automatically or on state changes

    // If already sharing, user should click "Stop Sharing" first
    if (isScreenSharing) {
      console.warn('⚠️ Already sharing. User must stop sharing first before starting a new share.');
      return;
    }

    try {
      console.log('🖥️ Requesting display media (user-initiated)...');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenTrack.onended = () => {
        console.log('🏁 Screen share track ended by browser');
        stopScreenShare();
      };

      localScreenStreamRef.current = screenStream;
      setLocalScreenStream(screenStream);

      const peerCount = peerConnectionsRef.current.size;
      console.log(`📡 Sharing screen with ${peerCount} peer(s)`);

      if (peerCount === 0) {
        console.warn('⚠️ No peers connected! Screen share will not be transmitted.');
      }

      peerConnectionsRef.current.forEach((pc, peerId) => {
        console.log(`\n🔍 Processing peer ${peerId}:`);
        console.log(`  - Signaling state: ${pc.signalingState}`);
        console.log(`  - ICE connection state: ${pc.iceConnectionState}`);
        console.log(`  - Connection state: ${pc.connectionState}`);

        const senders = pc.getSenders();
        console.log(`  - Current senders: ${senders.length}`);
        senders.forEach((s, i) => {
          console.log(`    [${i}] ${s.track?.kind || 'no-track'} (id: ${s.track?.id || 'none'})`);
        });

        const cameraVideoTrackId = localStreamRef.current?.getVideoTracks()[0]?.id;
        console.log(`  - Camera video track ID: ${cameraVideoTrackId || 'none'}`);
        console.log(`  - Screen track ID: ${screenTrack.id}`);

        // Find existing screen sender (video track that's NOT the camera)
        // We look for:
        // 1. A video sender with a track that is NOT the camera
        // 2. OR a video sender with NO track (idle) which is NOT the camera sender

        let screenSender = senders.find(s =>
          s.track &&
          s.track.kind === 'video' &&
          s.track.id !== cameraVideoTrackId
        );

        if (!screenSender) {
          // Try to find the "idle" video sender that isn't the camera sender
          const cameraSender = senders.find(s => s.track && s.track.id === cameraVideoTrackId);
          screenSender = senders.find(s =>
            s === null || // Just in case
            (!s.track && s !== cameraSender && s.dtlsTransport)
          );
        }

        if (screenSender) {
          console.log(`  🔄 REUSING/REPLACING screen track in existing sender`);
          screenSender.replaceTrack(screenTrack).then(() => {
            console.log(`  ✅ Screen track REPLACED successfully`);

            // Re-apply E2EE logic if needed (it might stay active on the sender/transceiver)
            // But we'll re-ensure it for safety if createEncodedStreams is available
            if (screenSender.createEncodedStreams) {
              // Usually this is set once on the sender, but no harm in logic checking
              console.log('  🔒 E2EE Encryption remains active for screen share');
            }
          }).catch(err => {
            console.error(`  ❌ Failed to replace screen track:`, err);
          });
        } else {
          console.log(`  ➕ ADDING new screen track`);
          try {
            const sender = pc.addTrack(screenTrack, screenStream);
            console.log(`  ✅ Screen track ADDED successfully, sender:`, sender);

            // Step 4: Media E2EE (Sender - Screen)
            if (sender.createEncodedStreams) {
              try {
                const streams = sender.createEncodedStreams();
                const transformer = new TransformStream({
                  transform: (frame, controller) => {
                    const key = window.mediaKey;
                    frame.data = encryptFrame(frame.data, key);
                    controller.enqueue(frame);
                  }
                });
                streams.readable.pipeThrough(transformer).pipeTo(streams.writable);
                console.log('  🔒 E2EE Encryption enabled for screen share');
              } catch (e) {
                console.error('  ❌ E2EE Screen Sender Error:', e);
              }
            }
          } catch (err) {
            console.error(`  ❌ Failed to add screen track:`, err);
          }
        }

        // CRITICAL: Force renegotiation immediately after adding screen track
        // replaceTrack() doesn't trigger negotiation, but addTrack() should
        // We force it here to ensure the remote peer gets the new track
        if (!screenSender) {
          // Only force negotiation if we ADDED a new track (not replaced)
          console.log(`  🔔 FORCING immediate negotiation for peer ${peerId} after adding screen track`);

          // Call the negotiation handler directly
          if (pc.onnegotiationneeded) {
            // Use setImmediate/setTimeout(0) to ensure addTrack completes first
            setTimeout(() => {
              console.log(`  📤 Executing negotiation now...`);
              pc.onnegotiationneeded();
            }, 0);
          } else {
            console.error(`  ❌ No onnegotiationneeded handler for peer ${peerId}!`);
          }
        }
      });

      setIsScreenSharing(true);

      // Broadcast sharing state
      if (socketRef.current && currentCallRef.current) {
        socketRef.current.emit('call_participant_state', {
          callId: currentCallRef.current.callId,
          isMicOff: !isMicOn,
          isCameraOff: !isCameraOn,
          isScreenSharing: true
        });
      }
    } catch (e) {
      console.error('Failed to start screen share:', e);
      // Don't set isScreenSharing to false if it was already true and we just failed a re-pick
      if (!isScreenSharing) setIsScreenSharing(false);
    }
  }

  async function stopScreenShare() {
    try {
      if (localScreenStreamRef.current) {
        console.log('🛑 Stopping local screen share tracks');
        localScreenStreamRef.current.getTracks().forEach(t => t.stop());
      }

      const cameraVideoTrackId = localStreamRef.current?.getVideoTracks()[0]?.id;

      peerConnectionsRef.current.forEach((pc, peerId) => {
        // Find the screen sender: It's a video sender that is NOT the camera
        const senders = pc.getSenders();
        const screenSender = senders.find(s =>
          s.track &&
          s.track.kind === 'video' &&
          s.track.id !== cameraVideoTrackId
        );

        if (screenSender) {
          console.log(`  ➖ Removing screen track from peer ${peerId}`);
          try {
            pc.removeTrack(screenSender);
            console.log(`  ✅ Screen track removed from peer ${peerId}`);

            // Force negotiation immediately
            if (pc.onnegotiationneeded) {
              console.log(`  🔔 Triggering immediate negotiation for removeTrack (${peerId})`);
              setTimeout(() => pc.onnegotiationneeded(), 0);
            }
          } catch (e) {
            console.error(`  ❌ Error removing track from peer ${peerId}:`, e);
          }
        } else {
          console.warn(`  ⚠️ Could not find screen sender to remove for peer ${peerId}`);
        }
      });

      localScreenStreamRef.current = null;
      setLocalScreenStream(null);
      setIsScreenSharing(false);

      // Broadcast sharing stopped
      if (socketRef.current && currentCallRef.current) {
        socketRef.current.emit('call_participant_state', {
          callId: currentCallRef.current.callId,
          isMicOff: !isMicOn,
          isCameraOff: !isCameraOn,
          isScreenSharing: false
        });
      }
    } catch (err) {
      console.error('Failed to stop screen share properly:', err);
    }
  }

  const handleSendMessage = (text, conversationId = null) => {
    const targetConvId = conversationId || activeId
    if (!text.trim() || !socket || !targetConvId) return
    const tempId = Math.random().toString(36).slice(2)
    const msg = { _id: tempId, tempId, conversation: targetConvId, sender: user, content: text, createdAt: new Date().toISOString(), deliveredTo: [], seenBy: [] }
    pushMessage(targetConvId, msg)
    socket.emit('message_send', { conversationId: targetConvId, content: text, tempId })
    socket.emit('stop_typing', { conversationId: targetConvId })
  }
  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-sky-50">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
        <div className="text-gray-600 font-medium">Loading your session...</div>
      </div>
    )
  }

  if (currentCall) {
    return (
      <CallPage
        call={currentCall}
        localStream={localStream}
        localScreenStream={localScreenStream}
        remoteStreams={remoteStreams}
        onEnd={endCall}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onStartScreen={startScreenShare}
        onStopScreen={stopScreenShare}
        isMicOn={isMicOn}
        isCameraOn={isCameraOn}
        isScreenSharing={isScreenSharing}
        conversation={conversations.find(c => c._id === currentCall.conversationId)}
        currentUser={user}
        messages={messages[currentCall.conversationId] || []}
        onSendMessage={(text) => handleSendMessage(text, currentCall.conversationId)}
        participantStates={participantStates}
        token={token}
        apiBase={API}
      />
    )
  }

  return (
    <div className="h-screen w-screen p-4">
      <div className="h-12 mb-3 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-yellow-400 grid place-items-center font-bold">💬</div>
          <div className="font-semibold text-lg">XevyTalk</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <button className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full">
              <span className="material-icons">folder</span>
            </button>
            <button className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full">
              <span className="material-icons">email</span>
            </button>
            <button className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full">
              <span className="material-icons">settings</span>
            </button>
          </div>
          <div className="relative flex items-center gap-1 bg-white rounded-xl shadow-soft px-2">
            <input
              placeholder="Search users..."
              value={topSearchQuery}
              onChange={e => setTopSearchQuery(e.target.value)}
              onFocus={() => topSearchQuery && setShowTopSearch(true)}
              onBlur={() => setTimeout(() => setShowTopSearch(false), 200)}
              className="border-0 bg-transparent px-2 py-1.5 text-sm w-48 focus:ring-0 outline-none"
            />
            <div className="h-5 w-px bg-gray-200"></div>
            <button className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full">
              <span className="material-icons text-lg">search</span>
            </button>
            {showTopSearch && topSearchResults.length > 0 && (
              <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                {topSearchResults.map(u => (
                  <button
                    key={u._id}
                    onClick={() => {
                      // Start direct chat logic
                      (async () => {
                        const r = await fetch(`${API}/api/conversations/direct`, {
                          credentials: 'include', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ userId: u._id })
                        })
                        const conv = await r.json()
                        setConversations(cs => (cs.find(c => c._id === conv._id) ? cs : [conv, ...cs]))
                        setActiveId(conv._id)
                        setTopSearchQuery('')
                        setShowTopSearch(false)
                      })()
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-sky-50 flex items-center gap-3 transition-colors border-b border-gray-50 last:border-0"
                  >
                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-semibold text-xs">
                      {u.username?.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">{u.username}</div>
                      <div className="text-xs text-gray-500 truncate">{u.email}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setProfileOpen(true)} className="ml-2 w-8 h-8 rounded-full border grid place-items-center bg-indigo-100 text-indigo-700 font-semibold">
            {String(user.username || '?').charAt(0).toUpperCase()}
          </button>
        </div>
      </div>

      <div className="h-[calc(100%-3.5rem)] bg-white rounded-3xl shadow-soft flex overflow-hidden">
        <div className="w-72 flex-none border-r h-full flex flex-col">
          {/* Chats/Calls Toggle */}
          <div className="flex-none p-4 border-b">
            <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setViewMode('chats')}
                className={`py-2 px-3 rounded-md text-sm font-medium transition-colors ${viewMode === 'chats'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                Chats
              </button>
              <button
                onClick={() => setViewMode('calls')}
                className={`py-2 px-3 rounded-md text-sm font-medium transition-colors relative ${viewMode === 'calls'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                Calls
                {unreadCallCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                    {unreadCallCount > 9 ? '9+' : unreadCallCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {viewMode === 'chats' ? (
              <LeftPanel user={user} conversations={conversations} activeId={activeId} onPick={setActiveId} onNew={() => setOpenNew(true)} />
            ) : (
              <CallsPanel
                user={user}
                callHistory={callHistory}
                token={token}
                onCallViewed={() => {
                  // Refresh call history and unread count when a call is marked as viewed
                  fetch(`${API}/api/calls`, {
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` }
                  })
                    .then(res => res.json())
                    .then(data => setCallHistory(Array.isArray(data) ? data : []))
                    .catch(err => console.error('Failed to refresh call history:', err))

                  fetch(`${API}/api/calls/unread/count`, {
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` }
                  })
                    .then(res => res.json())
                    .then(data => setUnreadCallCount(data.count || 0))
                    .catch(err => console.error('Failed to refresh unread count:', err))
                }}
                onStartCall={(userId) => {
                  // Start a call with the user
                  const partner = callHistory.find(c =>
                    String(c.caller._id) === String(userId) || String(c.callee._id) === String(userId)
                  )
                  if (partner) {
                    // Find or create conversation then start call
                    fetch(`${API}/api/conversations/direct`, {
                      credentials: 'include',
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ userId })
                    })
                      .then(r => r.json())
                      .then(conv => {
                        setConversations(cs => cs.find(c => c._id === conv._id) ? cs : [conv, ...cs])
                        setActiveId(conv._id)
                        // Switch back to chats view and trigger call
                        setViewMode('chats')
                        setTimeout(() => startCall('audio'), 100)
                      })
                      .catch(err => console.error('Failed to start call:', err))
                  }
                }} />
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0 h-full">
          <CenterPanel
            user={user}
            socket={socket}
            typingUsers={typingUsers}
            setShowMembers={setShowMembers}
            setInfoMsg={setInfoMsg}
            refreshMessages={refreshMessages}
            onStartCall={startCall}
            selectedMessages={selectedMessages}
            setSelectedMessages={setSelectedMessages}
            getDeletedIdsForConv={getDeletedIdsForConv}
            addDeletedForMe={addDeletedForMe}
            setEnlargedImage={setEnlargedImage}
          />
        </div>
        <div className="w-72 flex-none border-l h-full hidden xl:block">
          <RightPanel user={user} onOpenProfile={() => setProfileOpen(true)} />
        </div>
      </div>
      {openNew && <NewChatModal onClose={() => setOpenNew(false)} />}
      {profileOpen && <ProfileModal user={user} onClose={() => setProfileOpen(false)} onLogout={onLogout} />}
      {showMembers && <MembersModal conv={conversations.find(c => c._id === activeId)} onClose={() => setShowMembers(false)} />}
      {infoMsg && <MessageInfoModal message={infoMsg} conv={conversations.find(c => c._id === activeId)} onClose={() => setInfoMsg(null)} />}
      {incomingCall && !currentCall && (
        <IncomingCallModal
          call={incomingCall}
          conversations={conversations}
          onAccept={acceptIncomingCall}
          onReject={rejectIncomingCall}
        />
      )}
      {toast && <Toast notification={toast} onClose={() => setToast(null)} />}

      {/* Center Notification Modal */}
      {centerNotification && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="bg-white px-6 py-4 rounded-xl shadow-2xl border border-gray-100 flex items-center gap-3 animate-in fade-in zoom-in duration-200">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <span className="material-icons">info</span>
            </div>
            <div className="text-gray-800 font-medium">{centerNotification}</div>
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setEnlargedImage(null)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                const link = document.createElement('a')
                link.href = enlargedImage.url
                link.download = enlargedImage.name || 'image.png'
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
              }}
              title="Download"
              className="text-white hover:text-gray-300 text-xl flex items-center justify-center w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 cursor-pointer transition"
            >
              ⤓
            </button>
            <button
              onClick={() => setEnlargedImage(null)}
              className="text-white hover:text-gray-300 text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70"
            >
              ✕
            </button>
          </div>
          <img
            src={enlargedImage.url}
            alt={enlargedImage.name}
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Force Change Password Modal */}
      {user && user.mustChangePassword && (
        <ChangePasswordModal
          token={token}
          onComplete={(updatedUser) => {
            setUser(updatedUser)
            // Update localStorage as well
            localStorage.setItem('user', JSON.stringify(updatedUser))
          }}
        />
      )}
    </div>
  )
}

function Toast({ notification, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [notification])

  if (!notification) return null

  return (
    <div className="fixed top-4 right-4 z-50 bg-white rounded-xl shadow-xl p-4 border border-gray-100 animate-bounce max-w-sm cursor-pointer flex items-start gap-3" onClick={onClose}>
      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-xs font-semibold flex-shrink-0">
        {(notification.title || 'N').charAt(0).toUpperCase()}
      </div>
      <div>
        <div className="font-semibold text-sm">{notification.title}</div>
        <div className="text-xs text-gray-500 line-clamp-2">{notification.message}</div>
      </div>
    </div>
  )
}

function CallsPanel({ user, callHistory, onStartCall, token, onCallViewed }) {
  const [filter, setFilter] = useState('All')

  const getCallPartner = (call) => {
    const isOutgoing = String(call.caller._id) === String(user._id)
    return isOutgoing ? call.callee : call.caller
  }

  const getCallIcon = (call) => {
    const isOutgoing = String(call.caller._id) === String(user._id)

    if (call.status === 'missed') {
      // Missed can be either incoming (they didn't answer my call) or outgoing (I didn't answer their call)
      if (isOutgoing) {
        return { icon: 'phone_missed', color: 'text-red-500', label: 'Unanswered' }
      } else {
        return { icon: 'phone_missed', color: 'text-red-500', label: 'Missed incoming' }
      }
    }
    if (call.status === 'rejected') {
      return { icon: 'phone_disabled', color: 'text-gray-500', label: isOutgoing ? 'Call rejected' : 'Rejected' }
    }
    if (call.status === 'busy') {
      return { icon: 'phone_disabled', color: 'text-orange-500', label: 'Busy' }
    }
    if (isOutgoing) {
      return { icon: 'phone_forwarded', color: 'text-green-600', label: 'Outgoing' }
    }
    return { icon: 'phone_callback', color: 'text-blue-600', label: 'Incoming' }
  }

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return ''
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins === 0) return `${secs}s`
    return `${mins}m ${secs}s`
  }

  const formatTime = (date) => {
    const d = dayjs(date)
    const now = dayjs()
    if (d.isSame(now, 'day')) return d.format('h:mm A')
    if (d.isSame(now.subtract(1, 'day'), 'day')) return 'Yesterday'
    if (d.isAfter(now.subtract(7, 'day'))) return d.format('ddd')
    return d.format('DD/MM/YY')
  }

  const markAsViewed = async (callId, isViewed) => {
    if (isViewed) return // Already viewed

    try {
      await fetch(`${API}/api/calls/${callId}/viewed`, {
        credentials: 'include',
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (onCallViewed) onCallViewed()
    } catch (err) {
      console.error('Failed to mark call as viewed:', err)
    }
  }

  const isUnread = (call) => {
    const isIncoming = String(call.callee._id) === String(user._id)
    return isIncoming && !call.viewed
  }

  // Filter calls based on selected filter
  const filteredCalls = callHistory.filter(call => {
    if (filter === 'All') return true

    const isOutgoing = String(call.caller._id) === String(user._id)

    if (filter === 'Missed') {
      return call.status === 'missed'
    }
    if (filter === 'Outgoing') {
      return isOutgoing
    }
    if (filter === 'Incoming') {
      return !isOutgoing
    }
    return true
  })

  return (
    <div className="h-full bg-sky-50/40 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold">History</div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 cursor-pointer"
        >
          <option>All</option>
          <option>Missed</option>
          <option>Outgoing</option>
          <option>Incoming</option>
        </select>
      </div>

      <div className="space-y-2 overflow-y-auto h-[calc(100%-50px)] pr-2">
        {filteredCalls.length === 0 ? (
          <div className="text-center text-gray-400 py-8 text-sm">
            {filter === 'All' ? 'No call history' : `No ${filter.toLowerCase()} calls`}
          </div>
        ) : (
          filteredCalls.map((call) => {
            const partner = getCallPartner(call)
            const callIcon = getCallIcon(call)
            const duration = formatDuration(call.duration)
            const unread = isUnread(call)

            return (
              <div
                key={call._id}
                className="bg-white rounded-xl px-3 py-3 shadow-soft hover:shadow transition-shadow cursor-pointer relative"
                onClick={() => {
                  markAsViewed(call._id, call.viewed)
                  // Could trigger callback to start a new call with this user
                  if (onStartCall) onStartCall(partner._id)
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-semibold text-sm">
                      {partner.username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ${partner.status === 'online' ? 'bg-green-500' : 'bg-gray-400'} border-2 border-white`}></div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {partner.username || 'Unknown'}
                    </div>
                    <div className={`text-xs flex items-center gap-1 mt-1 ${callIcon.color}`}>
                      <span className="material-icons text-[16px] leading-none shrink-0">{callIcon.icon}</span>
                      <span className="whitespace-nowrap">{callIcon.label}</span>
                      {duration && (
                        <span className="text-gray-500 flex items-center shrink-0">
                          <span className="mx-1 text-[10px] self-center">●</span>
                          {duration}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-gray-500">{formatTime(call.startTime)}</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        markAsViewed(call._id, call.viewed)
                        // Start new call
                        if (onStartCall) onStartCall(partner._id)
                      }}
                      className="text-primary hover:text-primary/80 mt-1"
                    >
                      <span className="material-icons text-sm">call</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function LeftPanel({ user, conversations, activeId, onPick, onNew }) {
  const { leftTab, setLeftTab, unreadCounts, token, setConversations, setActiveId } = useStore()
  const tab = leftTab
  const [q, setQ] = useState('')
  const [allUsers, setAllUsers] = useState([])
  const [searchMode, setSearchMode] = useState(false)

  // Fetch all users for search
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' })
        const list = await r.json()
        setAllUsers(list.filter(u => String(u._id) !== String(user._id)))
      } catch (e) {
        console.error('Failed to load users', e)
      }
    })()
  }, [user?._id])

  // Ensure unique conversations (avoid duplicate keys) and sort by recency
  const uniqueConversations = [...new Map(conversations.map(c => [c._id, c])).values()]
  const sorted = uniqueConversations.sort((a, b) => {
    const ta = new Date(a.lastMessageAt || a.updatedAt || a.createdAt || 0).getTime()
    const tb = new Date(b.lastMessageAt || b.updatedAt || b.createdAt || 0).getTime()
    return tb - ta
  })

  const list = sorted.filter(c => {
    if (tab === 'direct' && c.type !== 'direct') return false
    if (tab === 'group' && c.type !== 'group') return false
    if (!q) return true
    const other = c.members?.find(m => String(m._id) !== String(user._id))
    const name = c.type === 'group' ? (c.name || '') : (other?.username || '')
    return name.toLowerCase().includes(q.toLowerCase())
  })

  // Search results from all users (only for Direct tab)
  const searchResults = (tab === 'direct' && q) ? allUsers.filter(u =>
    u.username?.toLowerCase().includes(q.toLowerCase()) ||
    u.email?.toLowerCase().includes(q.toLowerCase())
  ) : []

  const startDirect = async (userId) => {
    try {
      const r = await fetch(`${API}/api/conversations/direct`, {
        credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ userId })
      })
      const conv = await r.json()
      setConversations(cs => (cs.find(c => c._id === conv._id) ? cs : [conv, ...cs]))
      setActiveId(conv._id)
      setQ('')
      setSearchMode(false)
    } catch (e) {
      console.error('Failed to start conversation', e)
    }
  }

  // Calculate unread counts for each tab
  const directUnread = conversations
    .filter(c => c.type === 'direct')
    .reduce((sum, c) => sum + ((unreadCounts || {})[c._id] || 0), 0)

  const groupUnread = conversations
    .filter(c => c.type === 'group' && (c.name || '').toLowerCase() !== 'lobby')
    .reduce((sum, c) => sum + ((unreadCounts || {})[c._id] || 0), 0)

  return (
    <div className="h-full bg-sky-50/40 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold">Chats</div>
      </div>
      <div className="grid grid-cols-2 text-xs bg-white rounded-xl shadow-soft overflow-hidden mb-3">
        {['Direct', 'Group'].map((t) => {
          const key = t.toLowerCase()
          const active = tab === key
          const hasUnread = key === 'direct' ? directUnread > 0 : groupUnread > 0
          return (
            <button key={t} onClick={() => { setLeftTab(key); setQ(''); setSearchMode(false) }} className={`py-2 relative ${active ? 'bg-primary text-white' : 'text-gray-600'}`}>
              {t}
              {hasUnread && (
                <span className="absolute top-1 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
              )}
            </button>
          )
        })}
      </div>
      <div className="mb-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSearchMode(e.target.value.length > 0)
          }}
          className="w-full rounded-xl border-0 bg-white shadow-soft px-3 py-2 text-sm"
          placeholder={tab === 'direct' ? 'Search conversations or users...' : 'Search groups...'}
        />
      </div>

      {/* Create New Group button (only in Group tab) */}
      {tab === 'group' && (
        <button
          onClick={onNew}
          className="w-full mb-3 bg-primary text-white rounded-xl px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
        >
          <span>+</span>
          <span>Create New Group</span>
        </button>
      )}

      <div className="space-y-2 overflow-y-auto h-[calc(100%-180px)] pr-2">
        {tab === 'direct' && searchMode && searchResults.length > 0 ? (
          // Show user search results in Direct tab
          searchResults.map(u => (
            <button key={u._id} onClick={() => startDirect(u._id)} className="w-full text-left bg-white rounded-xl px-3 py-2 shadow-soft hover:shadow">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-700 grid place-items-center font-semibold">
                  {u.username?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">{u.username}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </div>
              </div>
            </button>
          ))
        ) : tab === 'direct' && searchMode && searchResults.length === 0 && list.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-4">No users or conversations found</div>
        ) : (
          // Show conversations (filtered by search)
          list.map(c => {
            const other = c.type === 'group' ? null : c.members.find(m => m._id !== user._id)
            const unread = (unreadCounts || {})[c._id] || 0

            // Get user status for direct chats
            const status = other?.status || 'offline'

            const statusColor =
              status === 'online' ? 'bg-green-500' :
                status === 'away' ? 'bg-orange-500' :
                  status === 'dnd' ? 'bg-purple-500' :
                    status === 'in_call' ? 'bg-red-500' :
                      'bg-gray-400'
            const statusLabel =
              status === 'online' ? 'Online' :
                status === 'away' ? 'Away' :
                  status === 'dnd' ? 'Do Not Disturb' :
                    status === 'in_call' ? 'In a call' :
                      'Offline'

            const isReallyOnline = status === 'online'

            return (
              <button
                key={c._id}
                onClick={() => onPick(c._id)}
                className={`w-full text-left rounded-xl px-3 py-3 transition-all ${activeId === c._id
                  ? 'bg-primary/10 shadow-md ring-2 ring-primary/30'
                  : 'bg-white shadow-soft hover:shadow-md'
                  }`}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar with status indicator */}
                  <div className="relative flex-shrink-0">
                    <div className={`w-10 h-10 rounded-full grid place-items-center font-semibold text-sm ${unread > 0
                      ? 'bg-primary text-white'
                      : 'bg-indigo-100 text-indigo-700'
                      }`}>
                      {c.type === 'group' ? '👥' : (other?.username || '?').charAt(0).toUpperCase()}
                    </div>
                    {/* Status dot for direct chats */}
                    {c.type === 'direct' && (
                      <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${statusColor}`}></span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${unread > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`} title={c.type === 'group' ? c.name : (other?.username || 'Direct')}>
                        {c.type === 'group' ? c.name : (other?.username || 'Direct')}
                      </div>
                      {c.type !== 'group' && isReallyOnline && (
                        <div className="text-[10px] text-green-600 flex items-center gap-1 mt-0.5">
                          <span className="w-1.5 h-1.5 bg-green-600 rounded-full"></span>
                          <span>Online</span>
                        </div>
                      )}
                    </div>
                    {unread > 0 && (
                      <div className="ml-2 flex-shrink-0 min-w-[20px] h-5 px-2 flex items-center justify-center rounded-full bg-primary text-white text-xs font-bold shadow-sm">
                        {unread > 99 ? '99+' : unread}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function CenterPanel({ user, socket, typingUsers, setShowMembers, setInfoMsg, refreshMessages, onStartCall, selectedMessages, setSelectedMessages, getDeletedIdsForConv, addDeletedForMe, setEnlargedImage }) {
  const { activeId, messages, pushMessage, token, conversations, setConversations, setActiveId, setMessages, removeMessage } = useStore()
  const [text, setText] = useState('')
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editingMessageContent, setEditingMessageContent] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showCallMenu, setShowCallMenu] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadSession, setUploadSession] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null)

  // Reset local state when active conversation changes
  useEffect(() => {
    setEditingMessageId(null)
    setEditingMessageContent('')
    setReplyingTo(null)
    setSelectedMessages(new Set())
    setShowOptionsMenu(false)
  }, [activeId])
  const listRef = useRef(null)
  const fileInputRef = useRef(null)
  const selectionHeaderRef = useRef(null)
  const selOptionsRef = useRef(null)
  const convOptionsRef = useRef(null)
  const emojiRef = useRef(null)
  const hiddenIds = activeId ? getDeletedIdsForConv(activeId) : new Set()
  const convMessages = activeId ? ((messages[activeId] || []).filter(m => !hiddenIds.has(String(m._id)))) : []

  const conv = useStore.getState().conversations.find(c => c._id === activeId)
  const membersCount = conv?.members?.length || 1
  const other = conv?.members?.find(m => String(m._id) !== String(user._id))

  const handleSaveEdit = async () => {
    if (!editingMessageId || !editingMessageContent.trim()) return

    try {
      const res = await fetch(`${API}/api/messages/${editingMessageId}`, {
        credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: editingMessageContent })
      })
      if (res.ok) {
        useStore.getState().updateMessage(activeId, editingMessageId, { content: editingMessageContent, editedAt: new Date().toISOString() })
        setEditingMessageId(null)
        setEditingMessageContent('')
      } else {
        alert('Failed to edit message')
      }
    } catch (e) {
      console.error('Error editing message:', e)
      alert('Failed to edit message')
    }
  }

  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditingMessageContent('')
  }

  // Close menus when switching chats
  useEffect(() => {
    setShowOptionsMenu(false)
    setShowCallMenu(false)
    setShowEmoji(false)
    setSelectedMessages(new Set())

    // Fetch conversation details to get fresh public keys
    if (activeId && token) {
      fetch(`${API}/api/conversations/${activeId}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.ok ? res.json() : null)
        .then(updatedConv => {
          if (updatedConv) {
            useStore.getState().setConversations(prev => {
              const idx = prev.findIndex(c => c._id === updatedConv._id)
              if (idx === -1) return [updatedConv, ...prev]
              const newConvs = [...prev]
              newConvs[idx] = updatedConv
              return newConvs
            })
          }
        })
        .catch(err => console.error('Failed to refresh conversation:', err))
    }
  }, [activeId, token])

  // Close emoji picker and conversation options when clicking outside
  useEffect(() => {
    const onDocClick = (e) => {
      const target = e.target
      const clickedEmoji = target && target.closest && target.closest('[data-role="emoji-picker"]')
      const clickedConvOptions = target && target.closest && target.closest('[data-role="conversation-options"]')
      const clickedCallMenu = target && target.closest && target.closest('[data-role="call-menu"]')
      const clickedSelectionHeader = selectionHeaderRef.current && selectionHeaderRef.current.contains(target)
      if (!clickedEmoji) setShowEmoji(false)
      if (!clickedConvOptions && !clickedSelectionHeader) setShowOptionsMenu(false)
      if (!clickedCallMenu) setShowCallMenu(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (selectedMessages.size === 0) return
    const onDocClick = (e) => {
      if (!selectionHeaderRef.current) return
      const clickedInsideHeader = selectionHeaderRef.current.contains(e.target)
      const clickedOnBubble = !!(e.target && e.target.closest && e.target.closest('[data-role="message-bubble"]'))
      if (!clickedInsideHeader && !clickedOnBubble) {
        setSelectedMessages(new Set())
        setShowOptionsMenu(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [selectedMessages.size])

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [convMessages.length])

  const handleSend = async () => {
    // Allow sending if there's text OR a file
    if ((!text.trim() && !previewFile) || !activeId) return

    console.log('🔍 handleSend called | replyingTo:', replyingTo, 'replyingTo._id:', replyingTo?._id)

    // If there's a file, it should already be uploaded (via handleFileSelect)
    // Now send message metadata via REST API
    if (previewFile && previewFile.fileId) {
      try {
        const res = await fetch(`${API}/api/messages/send`, {
          credentials: 'include',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            conversationId: activeId,
            messageText: text.trim() || '',
            fileId: previewFile.fileId,
            fileURL: previewFile.fileURL,
            fileName: previewFile.name,
            fileType: previewFile.type,
            fileSize: previewFile.size,
            replyTo: replyingTo?._id || null
          })
        })

        console.log('✅ File message sent with replyTo:', replyingTo?._id || null)

        if (!res.ok) {
          const error = await res.json()
          throw new Error(error.error || 'Failed to send message')
        }

        const message = await res.json()

        // Add to local state (server broadcasts via Socket.IO, but add locally for instant UI)
        pushMessage(activeId, {
          ...message,
          tempId: message.tempId || Math.random().toString(36).slice(2)
        })

        setText('')
        setPreviewFile(null)
        setUploadSession(null)
        setUploadProgress(0)
        setReplyingTo(null)

        if (socket) {
          socket.emit('stop_typing', { conversationId: activeId })
        }
      } catch (e) {
        console.error('Error sending message:', e)
        alert(e.message || 'Failed to send message. Please try again.')
      }
    } else if (!previewFile) {
      // Text-only message - can use WebSocket or REST API
      const tempId = Math.random().toString(36).slice(2)
      const msg = {
        _id: tempId,
        tempId,
        conversation: activeId,
        sender: user,
        content: text.trim(),
        replyTo: replyingTo?._id || null,
        createdAt: new Date().toISOString(),
        deliveredTo: [],
        seenBy: []
      }
      pushMessage(activeId, msg)

      console.log('📤 Text message send | replyingTo._id:', replyingTo?._id || null)

      // Send via WebSocket (text-only)
      if (socket) {
        let contentToSend = text.trim()

        // No E2EE encryption - backend will handle AES-256 encryption
        // Just send plaintext, backend encrypts it server-side

        socket.emit('message_send', {
          conversationId: activeId,
          content: contentToSend, // Send encrypted content
          replyTo: replyingTo?._id || null,
          tempId
        })
        socket.emit('stop_typing', { conversationId: activeId })
      }

      setText('')
      setReplyingTo(null)
    } else {
      // File selected but not uploaded yet
      alert('Please wait for file upload to complete')
    }
  }

  const isTyping = (typingUsers[activeId] && [...typingUsers[activeId]].filter(id => id !== user._id).length > 0)

  const onInput = (v) => {
    setText(v)
    if (socket && activeId) {
      if (v) socket.emit('typing', { conversationId: activeId })
      else socket.emit('stop_typing', { conversationId: activeId })
    }
  }

  const handleEmojiClick = (emojiData) => {
    setText(prev => prev + emojiData.emoji)
    setShowEmoji(false)
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Check file size (25MB limit)
    if (file.size > 25 * 1024 * 1024) {
      alert('File size should be less than 25MB')
      return
    }

    // Create preview URL
    const fileUrl = URL.createObjectURL(file)
    setPreviewFile({
      file,
      url: fileUrl,
      name: file.name,
      type: file.type,
      size: file.size
    })

    // Step 1: Create upload session (WhatsApp-like flow)
    setIsUploading(true)
    setUploadProgress(0)

    try {
      const sessionRes = await fetch(`${API}/api/media/create-upload-session`, {
        credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size
        })
      })

      if (!sessionRes.ok) {
        const error = await sessionRes.json()
        throw new Error(error.error || 'Failed to create upload session')
      }

      const sessionData = await sessionRes.json()
      setUploadSession(sessionData)

      // Step 2: Upload file directly to uploadURL
      const formData = new FormData()
      formData.append('file', file)

      const xhr = new XMLHttpRequest()

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100
          setUploadProgress(percentComplete)
        }
      })

      xhr.onload = () => {
        if (xhr.status === 200) {
          const uploadResult = JSON.parse(xhr.responseText)
          setPreviewFile(prev => ({
            ...prev,
            fileId: uploadResult.fileId,
            fileURL: uploadResult.fileURL
          }))
          setUploadProgress(100)
          setIsUploading(false)
        } else {
          throw new Error('Upload failed')
        }
      }

      xhr.onerror = () => {
        alert('Upload failed. Please try again.')
        setIsUploading(false)
        setUploadProgress(0)
        setPreviewFile(null)
        setUploadSession(null)
      }

      xhr.open('POST', sessionData.uploadURL)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.send(formData)

    } catch (e) {
      console.error('File upload error:', e)
      alert(e.message || 'Failed to upload file. Please try again.')
      setIsUploading(false)
      setUploadProgress(0)
      setPreviewFile(null)
      setUploadSession(null)
    }

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Clean up object URL when previewFile changes or component unmounts
  useEffect(() => {
    const currentUrl = previewFile?.url
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
    }
  }, [previewFile?.url])

  const toggleSelect = (id) => {
    setSelectedMessages(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const myId = String(user._id)
  const selectedMsgObjs = convMessages.filter(m => selectedMessages.has(m._id))
  const allMine = selectedMsgObjs.length > 0 && selectedMsgObjs.every(m => String(m.sender?._id || m.sender) === myId)
  const allUnseenByOthers = allMine

  if (!activeId) {
    return <div className="h-full flex flex-col">
      <div className="px-5 py-3 border-b flex items-center justify-between">
        <div className="font-semibold">Conversation</div>
        <div className="flex items-center gap-2 text-gray-400"></div>
      </div>
      <div className="flex-1 grid place-items-center bg-sky-50/40 text-gray-400 select-none">
        <div className="text-sm">Start your conversation</div>
      </div>
    </div>
  }

  return (
    <div className="h-full flex flex-col">
      <div ref={selectionHeaderRef} className="px-5 py-3 border-b flex items-center justify-between relative h-16">
        {selectedMessages.size > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedMessages(new Set())} className="p-2 hover:bg-gray-100 rounded-full" title="Clear Selection">
                <span className="material-icons">close</span>
              </button>
              <div className="font-semibold text-sm">{selectedMessages.size} selected</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  onClick={() => setShowOptionsMenu(v => !v)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                  title="Options"
                >
                  <span className="material-icons">more_vert</span>
                </button>
                {showOptionsMenu && (
                  <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border text-sm z-50 pointer-events-auto" data-role="conversation-options" ref={selOptionsRef}>
                    {selectedMessages.size === 1 && conv?.type === 'group' && (
                      <button
                        onClick={() => {
                          const msgId = [...selectedMessages][0];
                          const msg = convMessages.find(m => m._id === msgId);
                          if (msg) setInfoMsg(msg);
                          setSelectedMessages(new Set());
                          setShowOptionsMenu(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left rounded-t-xl"
                      >
                        <span className="material-icons">info</span>
                        <span>Info</span>
                      </button>
                    )}
                    {selectedMessages.size === 1 && (() => {
                      const msg = convMessages.find(m => m._id === [...selectedMessages][0])
                      const mine = msg && String(msg.sender?._id || msg.sender) === String(user._id)
                      return mine
                    })() && (
                        <button
                          onClick={() => {
                            const msgId = [...selectedMessages][0]
                            const msg = convMessages.find(m => m._id === msgId)

                            let content = msg?.content || ''

                            // Backend already decrypts AES-256 encryption
                            // Content is already plaintext, use as-is

                            setEditingMessageId(msgId)
                            setEditingMessageContent(content)
                            setSelectedMessages(new Set())
                            setShowOptionsMenu(false)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                        >
                          <span className="material-icons">edit</span>
                          <span>Edit</span>
                        </button>
                      )}
                    <button
                      onClick={async () => {
                        if (selectedMessages.size === 0) return
                        if (!confirm(`Delete ${selectedMessages.size} message(s) for yourself?`)) return
                        try {
                          // Optimistic update
                          const convId = activeId;
                          [...selectedMessages].forEach(msgId => {
                            removeMessage(convId, msgId)
                          })
                          addDeletedForMe(convId, [...selectedMessages])

                          setSelectedMessages(new Set())
                          setShowOptionsMenu(false)
                        } catch (e) {
                          console.error(e)
                          alert('Failed to delete')
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                      disabled={selectedMessages.size === 0}
                    >
                      <span className="material-icons">delete</span>
                      <span>Delete for Me</span>
                    </button>

                    {allMine && allUnseenByOthers && (
                      <button
                        onClick={async () => {
                          if (selectedMessages.size === 0) return
                          if (!confirm(`Delete ${selectedMessages.size} message(s) for everyone?`)) return
                          try {
                            const promises = [...selectedMessages].map(msgId =>
                              fetch(`${API}/api/messages/${msgId}?everyone=true`, {
                                credentials: 'include',
                                method: 'DELETE',
                                headers: { Authorization: `Bearer ${token}` }
                              })
                            )
                            await Promise.all(promises)

                            setSelectedMessages(new Set())
                            setShowOptionsMenu(false)
                          } catch (e) {
                            console.error(e)
                            alert('Failed to delete')
                          }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left rounded-b-xl"
                      >
                        <span className="material-icons">delete</span>
                        <span>Delete for Everyone</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="font-bold text-lg text-gray-900">{conv?.type === 'group' ? (conv?.name || 'Group') : (other?.username || 'Conversation')}</div>
              {conv?.type === 'group' && conv?.members && (
                <div className="text-xs text-gray-500">
                  {conv.members.length} members
                </div>
              )}
              {other && (
                <div className="text-xs flex items-center gap-1">
                  {other.status === 'online' ? (
                    <>
                      <span className="w-2 h-2 bg-green-600 rounded-full"></span>
                      <span className="text-green-600 font-medium">Online</span>
                    </>
                  ) : other.status === 'away' ? (
                    <>
                      <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                      <span className="text-orange-600 font-medium">Away</span>
                    </>
                  ) : other.status === 'dnd' ? (
                    <>
                      <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                      <span className="text-purple-600 font-medium">Do Not Disturb</span>
                    </>
                  ) : other.status === 'in_call' ? (
                    <>
                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                      <span className="text-red-600 font-medium">In a call</span>
                    </>
                  ) : (
                    <span className="text-gray-500">
                      {other.lastSeenAt
                        ? `Last seen ${dayjs(other.lastSeenAt).fromNow()}`
                        : 'Offline'}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 text-gray-400">
              {conv && (
                <>
                  <div className="relative" data-role="call-menu">
                    <button
                      title="Calls"
                      className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-base z-50"
                      onClick={() => setShowCallMenu(v => !v)}
                    >
                      <span className="material-icons">call</span>
                    </button>
                    {showCallMenu && (
                      <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-lg border text-sm z-50 pointer-events-auto" data-role="call-menu">
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                          onClick={() => { setShowCallMenu(false); onStartCall('video') }}
                        >
                          <span className="material-icons">videocam</span>
                          <span>Video call</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                          onClick={() => { setShowCallMenu(false); onStartCall('audio') }}
                        >
                          <span className="material-icons">call</span>
                          <span>Audio call</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <button
                title="Refresh messages"
                className="p-2 rounded-lg hover:bg-gray-100"
                onClick={refreshMessages}
              >
                <span className="material-icons">refresh</span>
              </button>
              <div className="relative">
                <button
                  title="Options"
                  className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-base"
                  onClick={() => setShowOptionsMenu(v => !v)}
                >
                  <span className="material-icons">more_vert</span>
                </button>
                {showOptionsMenu && (
                  <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border text-sm z-50 pointer-events-auto" data-role="conversation-options" ref={convOptionsRef}>
                    {conv?.type === 'direct' ? (
                      // Direct conversation: Delete for current user only
                      <button
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 text-red-600 text-left rounded-xl"
                        onClick={async () => {
                          if (!confirm('Delete this conversation? This will only remove it from your chat list.')) return
                          try {
                            await fetch(`${API}/api/conversations/${activeId}/leave`, {
                              credentials: 'include',
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}` }
                            })
                            setConversations(cs => cs.filter(c => c._id !== activeId))
                            setActiveId(null)
                            setShowOptionsMenu(false)
                          } catch (e) {
                            console.error(e)
                            alert('Failed to delete conversation')
                          }
                        }}
                      >
                        <span className="material-icons">delete</span>
                        <span>Delete Conversation</span>
                      </button>
                    ) : (
                      // Group conversation: Members + Clear + Leave
                      <>
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left rounded-t-xl"
                          onClick={() => {
                            setShowMembers(true)
                            setShowOptionsMenu(false)
                          }}
                        >
                          <span className="material-icons">group</span>
                          <span>Group Members</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                          onClick={async () => {
                            if (!confirm('Clear all messages in this group? This will only clear messages from your view.')) return
                            try {
                              await fetch(`${API}/api/conversations/${activeId}/clear`, {
                                credentials: 'include',
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}` }
                              })
                              // Clear messages locally
                              setMessages(activeId, [])
                              setShowOptionsMenu(false)
                            } catch (e) {
                              console.error(e)
                              alert('Failed to clear messages')
                            }
                          }}
                        >
                          <span className="material-icons">cleaning_services</span>
                          <span>Clear Conversation</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 text-red-600 text-left rounded-b-xl"
                          onClick={async () => {
                            if (!confirm('Leave this group? The group will be removed from your chat list.')) return
                            try {
                              await fetch(`${API}/api/conversations/${activeId}/leave`, {
                                credentials: 'include',
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}` }
                              })
                              setConversations(cs => cs.filter(c => c._id !== activeId))
                              setActiveId(null)
                              setShowOptionsMenu(false)
                            } catch (e) {
                              console.error(e)
                              alert('Failed to leave group')
                            }
                          }}
                        >
                          <span className="material-icons">logout</span>
                          <span>Leave Group</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-6 space-y-3 relative bg-gradient-to-br from-surface via-white to-surface-dark"
        onScroll={(e) => {
          // Find the current visible date while scrolling
          const scrollTop = e.target.scrollTop
          const messages = convMessages.filter(m => m.content || (m.attachments && m.attachments.length > 0))

          // Simple logic: show the date of the first message in view
          if (messages.length > 0) {
            const firstVisibleDate = dayjs(messages[0].createdAt).format('DD-MM-YYYY')
            // You can add state here to show sticky date if needed
          }
        }}
      >
        {convMessages.length === 0 && null}
        {convMessages
          .filter(m => m.content || (m.attachments && m.attachments.length > 0))
          .map((m, index, arr) => {
            // Check if we need to show a date stamp
            const currentDate = dayjs(m.createdAt).format('DD-MM-YYYY')
            const prevDate = index > 0 ? dayjs(arr[index - 1].createdAt).format('DD-MM-YYYY') : null
            const showDateStamp = index === 0 || currentDate !== prevDate

            return (
              <React.Fragment key={m._id}>
                {showDateStamp && (
                  <div className="flex justify-center my-4 sticky top-2 z-10">
                    <div className="bg-white/90 backdrop-blur-md px-4 py-1.5 rounded-full shadow-md text-xs font-medium text-gray-700 border border-gray-200">
                      {currentDate}
                    </div>
                  </div>
                )}
                <MessageBubble
                  me={user._id}
                  m={m}
                  totalMembers={membersCount}
                  conv={conv}
                  onInfo={() => setInfoMsg(m)}
                  selected={selectedMessages.has(m._id)}
                  onSelect={() => toggleSelect(m._id)}
                  editingMessageId={editingMessageId}
                  editingMessageContent={editingMessageContent}
                  setEditingMessageContent={setEditingMessageContent}
                  handleSaveEdit={handleSaveEdit}
                  handleCancelEdit={handleCancelEdit}
                  setEnlargedImage={setEnlargedImage}
                  setReplyingTo={setReplyingTo}
                />
              </React.Fragment>
            )
          })}
        {isTyping && <div className="text-xs text-gray-500">Typing...</div>}
      </div>
      <div className="p-4 border-t bg-white">
        {/* File Preview with Upload Progress */}
        {previewFile && (
          <div className="mb-3 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              {previewFile.type.startsWith('image/') ? (
                <img src={previewFile.url} alt={previewFile.name} className="w-16 h-16 object-cover rounded" />
              ) : (
                <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                  <span className="text-2xl">📎</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{previewFile.name}</div>
                <div className="text-xs text-gray-500">{(previewFile.size / 1024).toFixed(1)} KB</div>
                {isUploading && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Uploading {Math.round(uploadProgress)}%</div>
                  </div>
                )}
                {!isUploading && previewFile.fileId && (
                  <div className="text-xs text-green-600 mt-1">✓ Uploaded</div>
                )}
              </div>
              <button
                onClick={() => {
                  URL.revokeObjectURL(previewFile.url)
                  setPreviewFile(null)
                  setUploadSession(null)
                  setUploadProgress(0)
                  setIsUploading(false)
                }}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                disabled={isUploading}
              >
                ✕
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowEmoji(!showEmoji)} className="px-3 py-2 rounded-lg bg-gray-100" title="Emoji">
              <span className="material-icons">emoji_emotions</span>
            </button>
            {showEmoji && (
              <div className="absolute bottom-12 left-0 z-10" data-role="emoji-picker" ref={emojiRef}>
                <EmojiPicker onEmojiClick={handleEmojiClick} />
              </div>
            )}
          </div>
          <button onClick={() => fileInputRef.current?.click()} className="px-3 py-2 rounded-lg bg-gray-100" title="Attach">
            <span className="material-icons">attach_file</span>
          </button>
          <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
          {replyingTo && (
            <div className="px-4 py-2 bg-sky-50 border-l-4 border-primary rounded flex items-center justify-between">
              <div className="text-sm">
                <div className="text-gray-600">Replying to:</div>
                <div className="text-gray-900 font-medium truncate">{replyingTo.content?.substring(0, 50) || '(file message)'}</div>
              </div>
              <button onClick={() => setReplyingTo(null)} className="text-gray-500 hover:text-gray-700 px-2">✕</button>
            </div>
          )}
          <input
            value={text}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            className="flex-1 rounded-full border-0 bg-sky-50 px-4 py-3"
            placeholder={previewFile ? "Add a message (optional)..." : "Say something..."}
            disabled={isUploading}
          />
          <button
            onClick={handleSend}
            disabled={isUploading || (!text.trim() && (!previewFile || !previewFile.fileId))}
            className="bg-primary text-white px-4 py-3 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            title={isUploading ? 'Please wait for upload to complete' : 'Send message'}
          >
            {isUploading ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin">⏳</span>
                {Math.round(uploadProgress)}%
              </span>
            ) : 'Send'}
          </button>
        </div>
        {showNotifications && (
          <div className="absolute right-4 top-16 w-80 bg-white shadow-lg border rounded-xl z-20">
            <div className="px-3 py-2 flex items-center justify-between border-b">
              <div className="font-semibold text-sm">Notifications</div>
              <button className="text-xs text-gray-600" onClick={() => setShowNotifications(false)}>Close</button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2 space-y-2">
              {(useStore.getState().notifications || []).length === 0 ? (
                <div className="text-xs text-gray-500 px-2 py-3">No notifications</div>
              ) : (
                useStore.getState().notifications.map(n => (
                  <button key={n.id} onClick={() => { setShowNotifications(false); setActiveId(n.conversationId) }} className="w-full text-left px-2 py-2 hover:bg-gray-50 rounded-lg">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="text-xs text-gray-600 truncate">{n.message}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const getFileIcon = (type) => {
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('pdf')) return '📄';
  if (type.includes('word') || type.includes('document')) return '📝';
  if (type.includes('spreadsheet') || type.includes('excel')) return '📊';
  if (type.includes('presentation') || type.includes('powerpoint')) return '📑';
  if (type.includes('zip') || type.includes('compressed')) return '🗜️';
  return '📎';
};

function MessageBubble({ m, me, totalMembers, conv, onInfo, selected, onSelect, editingMessageId, editingMessageContent, setEditingMessageContent, handleSaveEdit, handleCancelEdit, setEnlargedImage, setReplyingTo }) {
  const [showHoverButtons, setShowHoverButtons] = useState(false)
  const [viewingAttachment, setViewingAttachment] = useState(null)

  // Backend uses AES-256 encryption and decrypts before sending
  // Content field should contain plaintext from backend
  let content = m.content || ''

  // Check if content looks like old E2EE-encrypted format (legacy messages)
  // Format: base64:base64 (2 parts with colon, no spaces)
  const looksLikeOldE2EE = typeof content === 'string' &&
    content.includes(':') &&
    content.split(':').length === 2 &&
    !content.includes(' ') &&
    content.length > 40 &&
    /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(content)

  // If it looks like old E2EE encrypted, show placeholder (can't decrypt without E2EE)
  // Otherwise, show the content (should be plaintext from backend AES-256 decryption)
  if (looksLikeOldE2EE) {
    content = "🔒 Encrypted message (legacy format, unable to decrypt)"
  }

  const mine = String(m.sender?._id || m.sender) === String(me)
  const senderName = m.sender?.username || (conv?.members || []).find(x => String(x._id) === String(m.sender))?.username || (mine ? 'You' : 'User')

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleDownload = (e, attachment) => {
    e.stopPropagation()
    const link = document.createElement('a')
    link.href = attachment.url || attachment.fileURL
    link.download = attachment.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    // Close the preview after download if it's open
    if (viewingAttachment) {
      setViewingAttachment(null);
    }
  }

  const handleAttachmentClick = (e, attachment) => {
    e.stopPropagation()
    // Open all files in preview modal (including PDFs)
    setViewingAttachment(attachment)
  }

  return (
    <div
      className={`flex ${mine ? 'justify-end' : 'justify-start'} group relative items-start gap-2`}
      onMouseEnter={() => setShowHoverButtons(true)}
      onMouseLeave={() => setShowHoverButtons(false)}
    >
      {mine && showHoverButtons && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setReplyingTo(m)
            setShowHoverButtons(false)
          }}
          title="Reply"
          className="text-gray-400 hover:text-primary flex-shrink-0 mt-1 pointer-events-auto z-10 hover:scale-125 transition-transform"
        >
          <span className="material-icons text-base">reply</span>
        </button>
      )}
      <div
        onClick={onSelect}
        data-role="message-bubble"
        className={`max-w-[70%] rounded-2xl px-4 py-3 shadow cursor-pointer transition-colors ${selected ? 'ring-2 ring-offset-1 ring-primary' : ''} ${mine ? 'bg-primary text-white rounded-br-sm' : 'bg-white rounded-bl-sm'}`}
      >
        {m.replyTo && (
          <div className={`mb-2 pb-2 border-l-2 pl-2 ${mine ? 'border-white/40 opacity-80' : 'border-primary/40'}`}>
            <div className={`text-xs font-medium ${mine ? 'text-white/90' : 'text-gray-600'}`}>
              {m.replyTo?.sender?.username || 'User'}
            </div>
            <div className={`text-xs line-clamp-2 ${mine ? 'text-white/80' : 'text-gray-700'}`}>
              {m.replyTo?.content || '(file message)'}
            </div>
          </div>
        )}
        {conv?.type === 'group' && (
          <div className={`text-[11px] mb-1 ${mine ? 'text-white/90' : 'text-gray-700'}`}>{senderName}</div>
        )}
        {m.attachments && m.attachments.length > 0 && (
          <div className="mb-2 space-y-2">
            {m.attachments.map((att, i) => (
              <div key={i} className="relative group">
                <button
                  onClick={(e) => handleAttachmentClick(e, att)}
                  className={`w-full text-left flex items-center gap-2 p-2 rounded text-xs cursor-pointer transition-colors ${mine ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                  title={`View ${att.name}`}
                >
                  <span className="w-6 h-6 flex items-center justify-center">
                    {getFileIcon(att.type)}
                  </span>
                  <span className="truncate flex-1">{att.name}</span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs">
                    View
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap">
          {editingMessageId === m._id ? (
            <>
              <input
                type="text"
                value={editingMessageContent}
                onChange={(e) => setEditingMessageContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit()
                  if (e.key === 'Escape') handleCancelEdit()
                }}
                className="w-full p-1 rounded bg-gray-100 text-gray-800"
              />
              <div className="flex gap-2 mt-2">
                <button onClick={handleSaveEdit} className="px-3 py-1 bg-primary text-white rounded-full text-xs">Save</button>
                <button onClick={handleCancelEdit} className="px-3 py-1 bg-gray-300 text-gray-800 rounded-full text-xs">Cancel</button>
              </div>
            </>
          ) : (
            (content || (m.attachments && m.attachments.length > 0)) ? (
              <div className="whitespace-pre-wrap break-words">{content}</div>
            ) : (
              <div className="whitespace-pre-wrap break-words text-gray-400 italic">(Empty message)</div>
            )
          )}
        </div>
        <div className={`text-[10px] mt-1 flex items-center gap-2 ${mine ? 'text-white/80' : 'text-gray-500'}`}>
          <span>{dayjs(m.createdAt).format('HH:mm')}</span>
          {m.editedAt && <span className="opacity-70">(edited)</span>}
          {mine && <StatusIcon m={m} me={me} totalMembers={totalMembers} />}
        </div>
      </div>

      {/* Attachment Preview Modal */}
      {viewingAttachment && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewingAttachment(null)}
        >
          <div
            className="relative bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b flex justify-between items-center">
              <div className="font-medium">{viewingAttachment.name || 'Attachment'}</div>
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(e, viewingAttachment);
                  }}
                  className="p-2 text-gray-700 hover:text-gray-900"
                  title="Download"
                >
                  <span className="material-icons">download</span>
                </button>
                <button
                  onClick={() => setViewingAttachment(null)}
                  className="p-2 text-gray-700 hover:text-gray-900"
                >
                  <span className="material-icons">close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
              {viewingAttachment.type.startsWith('image/') ? (
                <img
                  src={viewingAttachment.url || viewingAttachment.fileURL}
                  alt={viewingAttachment.name || 'Image'}
                  className="max-h-[70vh] max-w-full object-contain"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : viewingAttachment.type.startsWith('video/') ? (
                <video
                  src={viewingAttachment.url || viewingAttachment.fileURL}
                  controls
                  className="max-h-[70vh] max-w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  Your browser does not support the video tag.
                </video>
              ) : viewingAttachment.type.startsWith('audio/') ? (
                <div className="w-full max-w-md p-6">
                  <div className="flex flex-col items-center gap-4">
                    <span className="text-6xl">
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
              ) : viewingAttachment.type.includes('pdf') || viewingAttachment.name?.toLowerCase().endsWith('.pdf') ? (
                <div className="w-full h-full flex flex-col">
                  <iframe
                    src={`${viewingAttachment.url || viewingAttachment.fileURL}#toolbar=0`}
                    className="w-full h-full min-h-[70vh] border-0"
                    title={viewingAttachment.name || 'PDF Document'}
                    onError={(e) => {
                      console.error('PDF iframe failed to load:', e);
                      e.target.style.display = 'none';
                      e.target.nextElementSibling.style.display = 'flex';
                    }}
                  />
                  <div className="hidden flex-col items-center justify-center p-8 min-h-[70vh]">
                    <div className="text-6xl mb-4">📄</div>
                    <div className="text-lg font-medium mb-2">{viewingAttachment.name || 'PDF Document'}</div>
                    <p className="text-sm text-gray-600 mb-4">Unable to preview PDF in browser</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(e, viewingAttachment);
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors"
                    >
                      <span className="material-icons text-sm">download</span>
                      Download PDF
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center p-8 max-w-md">
                  <div className="text-6xl mb-4">
                    {getFileIcon(viewingAttachment.type)}
                  </div>
                  <div className="text-lg font-medium mb-2">{viewingAttachment.name || 'File'}</div>
                  <div className="text-sm text-gray-600 mb-6">
                    {viewingAttachment.type.split('/').pop().toUpperCase()} • {formatFileSize(viewingAttachment.size)}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(e, viewingAttachment);
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 mx-auto hover:bg-indigo-700 transition-colors"
                  >
                    <span className="material-icons text-sm">download</span>
                    Download File
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!mine && showHoverButtons && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setReplyingTo(m)
            setShowHoverButtons(false)
          }}
          title="Reply"
          className="text-gray-400 hover:text-primary flex-shrink-0 mt-1 pointer-events-auto z-10 hover:scale-125 transition-transform"
        >
          <span className="material-icons text-base">reply</span>
        </button>
      )}
    </div>
  )
}

function StatusIcon({ m, me, totalMembers }) {
  // Logic:
  // 1. If seenBy includes everyone (or at least one other person in direct), show Seen
  // 2. If deliveredTo includes everyone (or at least one other person in direct), show Delivered
  // 3. Else Sent

  // Exclude self from counts
  const seenCount = (m.seenBy || []).filter(id => String(id) !== String(me)).length
  const deliveredCount = (m.deliveredTo || []).filter(id => String(id) !== String(me)).length

  // For direct chat, we just need 1 other person
  // For group, we ideally want everyone, but for now let's say if ANYONE saw it, it's seen

  if (seenCount > 0) {
    return (
      <span className="flex items-center gap-1" title={`Seen by ${seenCount}`}>
        <span className="text-xs">✔✔</span>
        <span>Seen</span>
      </span>
    )
  }

  if (deliveredCount > 0) {
    return (
      <span className="flex items-center gap-1" title={`Delivered to ${deliveredCount}`}>
        <span className="text-[10px]">●</span>
        <span>Delivered</span>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1" title="Sent">
      <span className="text-[10px]">○</span>
      <span>Sent</span>
    </span>
  )
}

function CreateUserModal({ onClose, token }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess(null)
    setLoading(true)

    try {
      const res = await fetch(`${API}/api/admin/create-user`, {
        credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username, email })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user')
      }

      setSuccess(data)
      setUsername('')
      setEmail('')

      // Auto-close after 3 seconds
      setTimeout(() => {
        onClose()
      }, 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-[90%] max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Create User</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-green-700 font-medium mb-2">✓ {success.message}</div>
            <div className="text-sm text-green-600 space-y-1">
              <div><strong>Username:</strong> {success.user.username}</div>
              <div><strong>Email:</strong> {success.user.email}</div>
              {success.emailSent ? (
                <div className="mt-2 p-2 bg-green-100 rounded">
                  <div className="flex items-center gap-2">
                    <span>📧</span>
                    <span>Login credentials have been sent to the user's email</span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 p-2 bg-yellow-100 rounded">
                  <div className="text-yellow-700 text-xs">
                    <strong>Email failed.</strong> Password: {success.password}
                  </div>
                  <div className="text-xs mt-1">Please share these credentials manually</div>
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border-gray-300 bg-gray-50 px-4 py-2 focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="Enter username"
              required
              disabled={loading || success}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border-gray-300 bg-gray-50 px-4 py-2 focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="user@example.com"
              required
              disabled={loading || success}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
              disabled={loading || success}
            >
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ViewUsersModal({ onClose, token }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const r = await fetch(`${API}/api/admin/users`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (r.status === 401) {
        useStore.getState().logout();
        return;
      }
      if (!r.ok) throw new Error('Failed to fetch users')
      const data = await r.json()
      setUsers(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-[90%] max-w-2xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Created Users</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border-gray-300 bg-gray-50 px-4 py-2 focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm mb-4">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center text-gray-500 py-8">No users found</div>
          ) : (
            <div className="grid gap-3">
              {filteredUsers.map(u => (
                <div key={u.id || u._id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{u.username}</div>
                    <div className="text-sm text-gray-500 truncate">{u.email}</div>
                  </div>
                  <div className="text-xs text-gray-400">
                    {dayjs(u.createdAt).format('MMM D, YYYY')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ChangePasswordModal({ token, onComplete }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    console.log('ChangePasswordModal mounted');
  }, []);

  // Password validation checks
  const passwordChecks = useMemo(() => ({
    length: newPassword.length >= 8,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword)
  }), [newPassword])

  const allPasswordChecksPassed = Object.values(passwordChecks).every(Boolean)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!allPasswordChecksPassed) {
      setError('Please meet all password requirements')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const r = await fetch(`${API}/api/auth/change-password`, {
        credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword })
      })

      const data = await r.json()

      if (!r.ok) {
        throw new Error(data.error || 'Failed to update password')
      }

      onComplete(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100]">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-[90%] max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Change Password Required</h2>
          <p className="text-gray-600 mt-2">For your security, please update your temporary password to continue.</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm mb-4 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl border-gray-300 bg-gray-50 px-4 py-2 focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="Min. 8 characters"
              required
            />
          </div>

          {/* Password validation timeline */}
          {newPassword && (
            <div className="bg-sky-50 rounded-xl p-3 space-y-2">
              <div className="text-xs font-medium text-gray-600 mb-2">Password Requirements:</div>
              <div className="space-y-1.5">
                <div className={`flex items-center gap-2 text-xs ${passwordChecks.length ? 'text-green-600' : 'text-gray-500'}`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordChecks.length ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {passwordChecks.length ? '✓' : '○'}
                  </span>
                  <span>At least 8 characters</span>
                </div>
                <div className={`flex items-center gap-2 text-xs ${passwordChecks.uppercase ? 'text-green-600' : 'text-gray-500'}`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordChecks.uppercase ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {passwordChecks.uppercase ? '✓' : '○'}
                  </span>
                  <span>One uppercase letter (A-Z)</span>
                </div>
                <div className={`flex items-center gap-2 text-xs ${passwordChecks.lowercase ? 'text-green-600' : 'text-gray-500'}`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordChecks.lowercase ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {passwordChecks.lowercase ? '✓' : '○'}
                  </span>
                  <span>One lowercase letter (a-z)</span>
                </div>
                <div className={`flex items-center gap-2 text-xs ${passwordChecks.number ? 'text-green-600' : 'text-gray-500'}`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordChecks.number ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {passwordChecks.number ? '✓' : '○'}
                  </span>
                  <span>One number (0-9)</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border-gray-300 bg-gray-50 px-4 py-2 focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="Re-enter password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !allPasswordChecksPassed}
            className="w-full bg-primary hover:bg-primary-dark text-white rounded-xl py-3 font-semibold transition-colors disabled:opacity-50 mt-4"
          >
            {loading ? 'Updating Password...' : 'Update Password & Login'}
          </button>
        </form>
      </div>
    </div>
  )
}

function RightPanel({ user, onOpenProfile }) {
  const { token, setConversations, setActiveId, notifications, clearNotifications } = useStore()
  const [users, setUsers] = useState([])
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [showViewUsers, setShowViewUsers] = useState(false)

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' })
      const list = await r.json()
      // Show only 5 newest users
      const filtered = list.filter(u => String(u._id) !== String(user._id))
      const sorted = filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      setUsers(sorted.slice(0, 5))
    })()
  }, [user._id])

  const startDirect = async (id) => {
    const r = await fetch(`${API}/api/conversations/direct`, {
      credentials: 'include', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ userId: id })
    })
    const conv = await r.json()
    setConversations(cs => (cs.find(c => c._id === conv._id) ? cs : [conv, ...cs]))
    setActiveId(conv._id)
  }

  return (
    <div className="h-full bg-sky-50/40 p-4">
      <div className="h-full bg-white rounded-2xl shadow-soft p-4 overflow-y-auto">
        <ProfileCard user={user} onOpenProfile={onOpenProfile} />

        {/* Admin: Create & View User Buttons */}
        {user.isAdmin && (
          <div className="mt-4 mb-4 space-y-2">
            <button
              onClick={() => setShowCreateUser(true)}
              className="w-full bg-primary hover:bg-primary-dark text-white rounded-xl px-4 py-2.5 font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span className="material-icons">person_add</span>
              <span>Create User</span>
            </button>
            <button
              onClick={() => setShowViewUsers(true)}
              className="w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl px-4 py-2.5 font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span className="material-icons">group</span>
              <span>View Users</span>
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mb-3 mt-4">
          <div className="font-semibold">Notification</div>
          {notifications && notifications.length > 0 && (
            <button
              onClick={clearNotifications}
              className="text-[11px] text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </div>
        <div className="space-y-3 text-sm text-gray-600 mb-6">
          {(!notifications || notifications.length === 0) && (
            <>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200"></div>
                <div>Welcome! Start a chat from the left panel.</div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200"></div>
                <div>You can start <b>audio</b> or <b>video</b> calls from the chat header.</div>
              </div>
            </>
          )}
          {notifications && notifications.map(n => (
            <button
              key={n.id}
              onClick={() => setActiveId(n.conversationId)}
              className="w-full text-left flex items-start gap-3 px-2 py-2 rounded-xl hover:bg-sky-50 border border-sky-50"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-xs font-semibold">
                {(n.title || 'N').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-xs truncate">{n.title}</div>
                  {n.createdAt && (
                    <div className="text-[10px] text-gray-400 whitespace-nowrap">
                      {dayjs(n.createdAt).format('HH:mm')}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  {n.from && <span className="font-medium mr-1">{n.from}:</span>}
                  <span>{n.message}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="font-semibold mb-3">Suggestions</div>
        <div className="space-y-2">
          {users.map(u => (
            <div key={u._id} className="flex items-center justify-between bg-sky-50 rounded-xl px-3 py-2 gap-2">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-semibold flex-shrink-0">{u.username?.charAt(0)?.toUpperCase()}</div>
                <div className="text-sm truncate font-medium text-gray-700" title={u.username}>{u.username}</div>
              </div>
              <button onClick={() => startDirect(u._id)} className="flex-shrink-0 text-xs bg-primary text-white rounded-lg px-3 py-1 hover:bg-primary-dark transition-colors">Add</button>
            </div>
          ))}
          {users.length === 0 && (<div className="text-xs text-gray-500">No suggestions</div>)}
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateUser && (
        <CreateUserModal
          onClose={() => setShowCreateUser(false)}
          token={token}
        />
      )}

      {/* View Users Modal */}
      {showViewUsers && (
        <ViewUsersModal
          onClose={() => setShowViewUsers(false)}
          token={token}
        />
      )}
    </div>
  )
}

function ProfileCard({ user, onOpenProfile }) {
  // Get user's actual status
  const status = user.status || 'offline'
  const statusColor =
    status === 'online' ? 'bg-green-500' :
      status === 'away' ? 'bg-orange-500' :
        status === 'dnd' ? 'bg-purple-500' :
          status === 'in_call' ? 'bg-red-500' :
            'bg-gray-400'
  const statusTextColor =
    status === 'online' ? 'text-green-600' :
      status === 'away' ? 'text-orange-600' :
        status === 'dnd' ? 'text-purple-600' :
          status === 'in_call' ? 'text-red-600' :
            'text-gray-600'
  const statusLabel =
    status === 'online' ? 'Online' :
      status === 'away' ? 'Away' :
        status === 'dnd' ? 'Do Not Disturb' :
          status === 'in_call' ? 'In a call' :
            'Offline'

  return (
    <div className="bg-sky-50/60 rounded-2xl p-3 mb-2">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full border bg-indigo-100 text-indigo-700 grid place-items-center font-semibold">{user.username?.charAt(0)?.toUpperCase()}</div>
        <div className="flex-1">
          <div className="font-semibold">{user.username}</div>
          <div className={`text-xs ${statusTextColor} flex items-center gap-1`}>
            <span className={`w-2 h-2 ${statusColor} rounded-full`}></span>
            <span>{statusLabel}</span>
          </div>
        </div>
        <button onClick={onOpenProfile} className="text-xs bg-primary text-white rounded-lg px-3 py-1">View</button>
      </div>
    </div>
  )
}

function ProfileModal({ user, onClose, onLogout }) {
  const { token, setUser } = useStore()
  const [userStatus, setUserStatus] = useState(user.status || 'online')
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [phone, setPhone] = useState(user.phone || '')
  const [address, setAddress] = useState(user.address || '')
  const [error, setError] = useState('')

  // Sync status when user prop changes (e.g., when call starts/ends)
  useEffect(() => {
    if (user.status && user.status !== userStatus) {
      setUserStatus(user.status)
    }
  }, [user.status])

  // Update status
  const handleStatusChange = async (newStatus) => {
    if (newStatus === userStatus || newStatus === 'in_call') return

    try {
      setLoading(true)
      const r = await fetch(`${API}/api/users/status`, {
        credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      })

      if (!r.ok) {
        throw new Error('Failed to update status')
      }

      setUserStatus(newStatus)
      // Save to localStorage for persistence
      localStorage.setItem('userStatus', newStatus)
    } catch (err) {
      console.error('Error updating status:', err)
      alert('Failed to update status')
    } finally {
      setLoading(false)
    }
  }

  // Save profile changes (phone and address only)
  const handleSaveProfile = async () => {
    try {
      setLoading(true)
      setError('')

      const r = await fetch(`${API}/api/users/me`, {
        credentials: 'include',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ phone, address })
      })

      const data = await r.json()

      if (!r.ok) {
        throw new Error(data.error || 'Failed to update profile')
      }

      // Update user in global state
      setUser({ ...user, phone, address })
      setEditMode(false)
      alert('Profile updated successfully!')
    } catch (err) {
      console.error('Error saving profile:', err)
      setError(err.message || 'Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  // Get status color and label
  const getStatusInfo = (status) => {
    switch (status) {
      case 'online':
        return { color: 'bg-green-500', label: 'Online' }
      case 'away':
        return { color: 'bg-orange-500', label: 'Away' }
      case 'dnd':
        return { color: 'bg-purple-500', label: 'Do Not Disturb' }
      case 'in_call':
        return { color: 'bg-red-500', label: 'In a call' }
      default:
        return { color: 'bg-gray-400', label: 'Offline' }
    }
  }

  const statusInfo = getStatusInfo(userStatus)

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="w-[520px] bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold text-lg">My Profile</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {/* Avatar and Name */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-24 h-24 rounded-full border mb-3 bg-indigo-100 text-indigo-700 grid place-items-center text-3xl font-bold">
            {(user.username || '?').charAt(0).toUpperCase()}
          </div>
          <div className="text-lg font-semibold">{user.username}</div>

          {/* Status Dropdown */}
          <div className="mt-3 relative">
            <select
              value={userStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={loading || userStatus === 'in_call'}
              className="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 pr-8 text-sm font-medium cursor-pointer hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ paddingLeft: '32px' }}
            >
              <option value="online">Online</option>
              <option value="away">Away</option>
              <option value="dnd">Do Not Disturb</option>
              {userStatus === 'in_call' && <option value="in_call">In a call</option>}
            </select>
            {/* Status dot indicator */}
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${statusInfo.color}`}></span>
            {/* Dropdown arrow */}
            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">▼</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {/* Info Fields */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {/* Email - Read Only */}
          <div className="bg-sky-50/60 rounded-xl p-3">
            <div className="text-gray-500 text-xs mb-1">Email</div>
            <div className="font-medium">{user.email || 'Not set'}</div>
          </div>

          {/* Phone - Editable */}
          <div className="bg-sky-50/60 rounded-xl p-3">
            <div className="text-gray-500 text-xs mb-1">Phone</div>
            {editMode ? (
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border-0 bg-white px-2 py-1 text-sm"
                placeholder="Enter phone"
              />
            ) : (
              <div className="font-medium">{user.phone || 'Not set'}</div>
            )}
          </div>

          {/* Address - Editable */}
          <div className="bg-sky-50/60 rounded-xl p-3 col-span-2">
            <div className="text-gray-500 text-xs mb-1">Address</div>
            {editMode ? (
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border-0 bg-white px-2 py-1 text-sm"
                placeholder="Enter address"
              />
            ) : (
              <div className="font-medium">{user.address || 'Not set'}</div>
            )}
          </div>

          {/* Joined - Read Only */}
          <div className="bg-sky-50/60 rounded-xl p-3">
            <div className="text-gray-500 text-xs mb-1">Joined</div>
            <div className="font-medium">{dayjs(user.createdAt || new Date()).format('DD MMM YYYY')}</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex justify-between">
          {editMode ? (
            <>
              <button
                onClick={handleSaveProfile}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditMode(false)
                    setPhone(user.phone || '')
                    setAddress(user.address || '')
                    setError('')
                  }}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditMode(true)}
                className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90"
              >
                Edit Profile
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">
                  Close
                </button>
                <button onClick={onLogout} className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600">
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import './env.js';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import User from './models/User.js';
import Message from './models/Message.js';
import Conversation, { ConversationMember } from './models/Conversation.js';
import CallHistory from './models/CallHistory.js';
import { toSafeMessage } from './utils/message.js';
import { encryptText } from './utils/encryption.js';
import { adaptToFrontend } from './utils/frontendAdapter.js';
import { Op } from 'sequelize';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-prod';
const PORT = process.env.PORT || 4000;

// Track active calls for duration calculation
const activeCalls = new Map(); // callId -> { callerId, callees: Set(), startTime, type }

export const initSocket = (io) => {
    // Socket.IO auth for WebSocket connections
    io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token;
        let u = null;
        if (token) {
            try {
                const payload = jwt.verify(token, JWT_SECRET);
                u = await User.findByPk(payload.id);
            } catch { }
        }
        if (!u) {
            const userId = socket.handshake.auth?.userId; // dev fallback
            if (userId) u = await User.findByPk(userId);
        }
        if (!u) return next(new Error('unauthorized'));
        socket.user = u;
        next();
    });

    // Reset all statuses to offline on startup (avoid stale online markers)
    User.update({ status: 'offline' }, { where: {} }).catch(e => console.error('Initial status reset error:', e));

    io.on('connection', async (socket) => {
        const user = socket.user;
        socket.join(`user:${user.id}`);

        // Mark user online if they were offline or away (resetting to online on fresh login)
        // If they were already in-call/away/dnd, we might want to preserve it, but 
        // usually connecting means "active".
        const oldStatus = user.status;
        const newStatus = (oldStatus === 'offline' || !oldStatus) ? 'online' : oldStatus;

        user.lastSeenAt = new Date();
        user.status = newStatus;
        await user.save().catch(() => { });

        io.emit('user_status_changed', {
            userId: String(user.id),
            username: user.username,
            status: user.status,
            lastSeenAt: user.lastSeenAt,
        });

        socket.on('join_conversation', (conversationId) => {
            socket.join(`conv:${conversationId}`);
        });

        socket.on('leave_conversation', (conversationId) => {
            socket.leave(`conv:${conversationId}`);
        });

        socket.on('typing', ({ conversationId }) => {
            socket.to(`conv:${conversationId}`).emit('typing', { userId: String(user.id), conversationId });
        });

        socket.on('stop_typing', ({ conversationId }) => {
            socket.to(`conv:${conversationId}`).emit('stop_typing', { userId: String(user.id), conversationId });
        });

        // Socket.IO message_send - ONLY for text messages or already-uploaded file metadata
        socket.on('message_send', async ({ conversationId, content, tempId, attachments, replyTo }) => {
            if (!content && (!attachments || attachments.length === 0)) return;

            const encContent = content ? encryptText(content) : '';

            let parsedAttachments = [];
            if (attachments) {
                try {
                    parsedAttachments = typeof attachments === 'string' ? JSON.parse(attachments) : attachments;
                    parsedAttachments = parsedAttachments
                        .filter(att => att.fileId && att.fileURL)
                        .map(att => ({
                            fileId: att.fileId,
                            fileURL: att.fileURL,
                            name: att.name || 'file',
                            type: att.type || 'application/octet-stream',
                            size: att.size || 0,
                            thumbnailURL: att.thumbnailURL || null
                        }));
                } catch (e) {
                    console.error('Failed to parse attachments:', e);
                    parsedAttachments = [];
                }
            }

            const msg = await Message.create({
                conversationId: conversationId,
                senderId: user.id,
                contentEnc: encContent,
                tempId,
                attachments: parsedAttachments,
                replyToId: replyTo || null
            });

            await Conversation.update(
                { lastMessageAt: new Date() },
                { where: { id: conversationId } }
            );

            // Reset hidden status
            await ConversationMember.update(
                { hidden: false },
                { where: { ConversationId: conversationId } }
            );

            const populated = await Message.findByPk(msg.id, {
                include: [
                    {
                        model: User,
                        as: 'Sender',
                        attributes: ['id', 'username', 'email', 'avatar']
                    },
                    {
                        model: Message,
                        as: 'ReplyTo'
                    }
                ]
            });

            const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
            const safe = toSafeMessage(populated);
            if (safe.attachments && safe.attachments.length > 0) {
                const host = (process.env.BACKEND_URL || `13.205.101.250:${PORT}`).replace(/^https?:\/\//, '');
                safe.attachments = safe.attachments.map(att => ({
                    ...att,
                    url: att.fileURL || att.url || `${protocol}://${host}/api/files/${att.fileId}`
                }));
            }

            const finalMsg = adaptToFrontend(safe);
            io.to(`conv:${conversationId}`).emit('message_new', finalMsg);
        });

        socket.on('message_delivered', async ({ messageId }) => {
            const m = await Message.findByPk(messageId);
            if (!m) return;

            const deliveredTo = m.deliveredTo || [];
            if (!deliveredTo.includes(String(user.id))) {
                deliveredTo.push(String(user.id));
                await m.update({ deliveredTo });
            }

            io.to(`conv:${m.conversationId}`).emit('message_update', { messageId, deliveredTo });
        });

        socket.on('message_seen', async ({ conversationId }) => {
            if (!conversationId) return;

            /**
             * Mark all messages in this conversation as seen by the current user.
             *
             * NOTE:
             *  - `seenBy` is stored as JSONB (array of userId strings)
             *  - The previous implementation tried to use `array_position` in SQL on jsonb,
             *    which crashes on Postgres installations that don't support that combo.
             *  - We instead load candidate messages and filter/update them in JS.
             */
            const msgs = await Message.findAll({
                where: {
                    conversationId
                },
                attributes: ['id', 'seenBy', 'conversationId']
            });

            for (const m of msgs) {
                const seenBy = Array.isArray(m.seenBy) ? m.seenBy.map(String) : [];
                if (!seenBy.includes(String(user.id))) {
                    const nextSeenBy = [...seenBy, String(user.id)];
                    await m.update({ seenBy: nextSeenBy });
                    io.to(`conv:${conversationId}`).emit('message_update', {
                        messageId: String(m.id),
                        seenBy: nextSeenBy
                    });
                }
            }
        });

        // Audio / video call signaling
        socket.on('call_start', async ({ conversationId, kind }) => {
            try {
                if (!conversationId) return;
                const conv = await Conversation.findByPk(conversationId, {
                    include: [{
                        model: User,
                        as: 'Members',
                        attributes: ['id', 'username', 'avatar']
                    }]
                });

                if (!conv) return;

                const isMember = conv.Members.some(m => String(m.id) === String(user.id));
                if (!isMember) {
                    socket.emit('call_error', { error: 'Not a member of this conversation' });
                    return;
                }

                const callId = uuidv4();
                const payload = {
                    callId,
                    conversationId: String(conv.id),
                    kind: kind === 'video' ? 'video' : 'audio',
                    from: { _id: String(user.id), id: String(user.id), username: user.username, avatar: user.avatar },
                    isGroup: conv.type === 'group',
                    participants: conv.Members.map(m => ({
                        _id: String(m.id),
                        id: String(m.id),
                        username: m.username,
                        avatar: m.avatar
                    }))
                };

                await user.update({ status: 'in_call' });
                io.emit('user_status_changed', {
                    userId: String(user.id),
                    status: 'in_call',
                    lastSeenAt: new Date()
                });

                socket.join(`call:${callId}`);
                socket.join(`conv:${conversationId}`);
                socket.emit('call_started', payload);

                // Track call for history
                const calleeIds = conv.Members
                    .filter(m => String(m.id) !== String(user.id))
                    .map(m => String(m.id));

                activeCalls.set(callId, {
                    callerId: String(user.id),
                    callees: new Set(calleeIds),
                    acceptedCallees: new Set(),
                    startTime: new Date(),
                    type: kind === 'video' ? 'video' : 'audio',
                    conversationId: String(conversationId)
                });

                const notifiedMembers = conv.Members
                    .filter(m => String(m.id) !== String(user.id));

                // Check each member - if they're already in a call, log as missed immediately
                for (const m of notifiedMembers) {
                    const callee = await User.findByPk(m.id);
                    if (callee && callee.status === 'in_call') {
                        // User is already in a call, log as missed
                        try {
                            const callRecord = await CallHistory.create({
                                callerId: String(user.id),
                                calleeId: String(m.id),
                                type: kind === 'video' ? 'video' : 'audio',
                                status: 'missed',
                                startTime: new Date(),
                                endTime: new Date(),
                                duration: 0
                            });
                            io.to(`user:${m.id}`).emit('new_call_history', {
                                callId: callRecord.id,
                                status: 'missed'
                            });
                        } catch (err) {
                            console.error('Failed to log missed call (user busy):', err);
                        }
                    } else {
                        // User is available, send incoming call notification
                        io.to(`user:${m.id}`).emit('call_incoming', payload);
                    }
                }

                console.log(`Call started: ${callId} in ${conv.type} conversation`);
            } catch (e) {
                console.error('call_start error', e);
                socket.emit('call_error', { error: e.message });
            }
        });

        socket.on('call_accept', async ({ callId, conversationId }) => {
            try {
                if (!callId || !conversationId) return;

                const conv = await Conversation.findByPk(conversationId, {
                    include: [{
                        model: User,
                        as: 'Members',
                        attributes: ['id', 'username', 'avatar']
                    }]
                });

                if (!conv) {
                    socket.emit('call_error', { error: 'Conversation not found' });
                    return;
                }

                const isMember = conv.Members.some(m => String(m.id) === String(user.id));
                if (!isMember) {
                    socket.emit('call_error', { error: 'Not a member of this conversation' });
                    return;
                }

                await user.update({ status: 'in_call' });
                io.emit('user_status_changed', {
                    userId: String(user.id),
                    status: 'in_call',
                    lastSeenAt: new Date()
                });

                socket.join(`call:${callId}`);
                socket.join(`conv:${conversationId}`);

                // Track acceptance
                const callData = activeCalls.get(callId);
                if (callData) {
                    callData.acceptedCallees.add(String(user.id));
                }

                const room = io.sockets.adapter.rooms.get(`call:${callId}`);
                const otherSocketIds = room ? [...room].filter(id => id !== socket.id) : [];
                const otherUserIds = [];
                for (const sid of otherSocketIds) {
                    const s = io.sockets.sockets.get(sid);
                    if (s?.user?.id) {
                        otherUserIds.push(String(s.user.id));
                    }
                }

                socket.emit('call_existing_participants', {
                    callId,
                    conversationId,
                    userIds: otherUserIds,
                    participants: conv.Members.map(m => ({
                        _id: String(m.id),
                        id: String(m.id),
                        username: m.username,
                        avatar: m.avatar
                    })) || []
                });

                socket.to(`call:${callId}`).emit('call_peer_accepted', {
                    callId,
                    conversationId,
                    userId: String(user.id),
                    username: user.username,
                    avatar: user.avatar,
                    participants: conv.Members.map(m => ({
                        _id: String(m.id),
                        id: String(m.id),
                        username: m.username,
                        avatar: m.avatar
                    })) || []
                });

            } catch (e) {
                console.error('call_accept error', e);
                socket.emit('call_error', { error: e.message });
            }
        });

        socket.on('call_signal', ({ callId, toUserId, data }) => {
            try {
                if (!callId || !toUserId || !data) return;
                io.to(`user:${toUserId}`).emit('call_signal', {
                    callId,
                    fromUserId: String(user.id),
                    fromUsername: user.username,
                    fromAvatar: user.avatar,
                    data,
                });
            } catch (e) {
                console.error('call_signal error', e);
            }
        });

        socket.on('call_end', async ({ callId, conversationId }) => {
            try {
                if (!callId || !conversationId) return;

                const conv = await Conversation.findByPk(conversationId, {
                    include: [{
                        model: User,
                        as: 'Members',
                        attributes: ['id', 'username', 'avatar']
                    }]
                });

                if (!conv) return;

                // Only reset status for the caller and any accepted callees, and only if they are actually connected.
                const callDataForStatus = activeCalls.get(callId);
                const participantsToReset = new Set();
                if (callDataForStatus) {
                    participantsToReset.add(callDataForStatus.callerId);
                    callDataForStatus.acceptedCallees.forEach(id => participantsToReset.add(id));
                }

                for (const memberId of participantsToReset) {
                    // Check if user has active sockets before setting to online
                    const hasSockets = io.sockets.adapter.rooms.get(`user:${memberId}`)?.size > 0;
                    const finalStatus = hasSockets ? 'online' : 'offline';

                    await User.update(
                        { status: finalStatus },
                        { where: { id: memberId } }
                    );
                    io.emit('user_status_changed', {
                        userId: memberId,
                        status: finalStatus,
                        lastSeenAt: new Date()
                    });
                }

                // Log call history
                const callData = activeCalls.get(callId);
                if (callData) {
                    const duration = Math.floor((new Date() - callData.startTime) / 1000);

                    // Log call for each callee
                    for (const calleeId of callData.callees) {
                        const wasAccepted = callData.acceptedCallees.has(calleeId);
                        const status = wasAccepted ? 'completed' : 'missed';

                        try {
                            const callRecord = await CallHistory.create({
                                callerId: callData.callerId,
                                calleeId: calleeId,
                                type: callData.type,
                                status: status,
                                startTime: callData.startTime,
                                endTime: new Date(),
                                duration: wasAccepted ? duration : 0
                            });

                            // Notify callee of new unread call (only if not accepted/missed)
                            if (!wasAccepted) {
                                io.to(`user:${calleeId}`).emit('new_call_history', {
                                    callId: callRecord.id,
                                    status: status
                                });
                            }
                        } catch (err) {
                            console.error('Failed to log call history:', err);
                        }
                    }

                    // Remove from active calls
                    activeCalls.delete(callId);
                }

                const payload = {
                    callId,
                    conversationId,
                    fromUserId: String(user.id),
                    fromUsername: user.username,
                    participants: conv.Members.map(m => ({
                        _id: String(m.id),
                        id: String(m.id),
                        username: m.username,
                        avatar: m.avatar
                    })) || []
                };
                io.to(`call:${callId}`).emit('call_ended', payload);
                io.to(`conv:${conversationId}`).emit('call_ended', payload);

            } catch (e) {
                console.error('call_end error', e);
            }
        });

        socket.on('call_leave', async ({ callId }) => {
            if (!callId) return;
            socket.leave(`call:${callId}`);
            socket.to(`call:${callId}`).emit('call_user_left', {
                callId,
                userId: String(user.id),
            });

            const hasSockets = io.sockets.adapter.rooms.get(`user:${user.id}`)?.size > 0;
            const nextStatus = hasSockets ? 'online' : 'offline';
            await user.update({ status: nextStatus });
            io.emit('user_status_changed', {
                userId: String(user.id),
                status: nextStatus,
                lastSeenAt: new Date()
            });
        });

        socket.on('call_participant_state', ({ callId, isMicOff, isCameraOff, isScreenSharing }) => {
            if (!callId) return;
            console.log(`[Signaling] call_participant_state from ${user.username}: mic=${!!isMicOff}, cam=${!!isCameraOff}, screen=${!!isScreenSharing}`);
            socket.to(`call:${callId}`).emit('call_participant_state', {
                callId,
                userId: String(user.id),
                isMicOff,
                isCameraOff,
                isScreenSharing
            });
        });

        socket.on('disconnect', async () => {
            const rooms = io.sockets.adapter.sids.get(socket.id);
            if (rooms) {
                rooms.forEach((room) => {
                    if (room.startsWith('call:')) {
                        const callId = room.split(':')[1];
                        socket.to(room).emit('call_user_left', {
                            callId,
                            userId: String(user.id),
                        });
                    }
                });
            }

            user.lastSeenAt = new Date();
            user.status = 'offline';
            await user.save().catch(() => { });

            io.emit('user_status_changed', {
                userId: String(user.id),
                username: user.username,
                status: 'offline',
                lastSeenAt: user.lastSeenAt,
            });
        });
    });

    // Heartbeat
    setInterval(() => {
        if (!io) return;
        io.sockets.sockets.forEach((socket) => {
            if (socket.user) {
                User.update(
                    { lastSeenAt: new Date() },
                    { where: { id: socket.user.id } }
                ).catch(e => console.error('Heartbeat update error:', e.message));
            }
        });
    }, 60 * 1000);
};

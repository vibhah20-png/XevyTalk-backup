
import Conversation, { ConversationMember } from '../models/Conversation.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import UploadSession from '../models/UploadSession.js';
import { toSafeMessage } from '../utils/message.js';
import { encryptText } from '../utils/encryption.js';
import { adaptToFrontend } from '../utils/frontendAdapter.js';
import { Op } from 'sequelize';

export const getConversations = async (req, res) => {
    try {
        // Get all conversations where user is a member and not hidden
        const conversations = await Conversation.findAll({
            include: [
                {
                    model: User,
                    as: 'Members',
                    through: {
                        where: {
                            UserId: req.user.id,
                            hidden: false
                        }
                    }
                }
            ],
            order: [['updatedAt', 'DESC']],
            limit: 50
        });

        // Filter out conversations where user is not a member
        const userConversations = conversations.filter(conv => {
            return conv.Members && conv.Members.length > 0;
        });

        // Populate all members for each conversation
        const populatedConversations = await Promise.all(
            userConversations.map(async (conv) => {
                const fullConv = await Conversation.findByPk(conv.id, {
                    include: [{
                        model: User,
                        as: 'Members',
                        attributes: ['id', 'username', 'email', 'avatar', 'status', 'lastSeenAt', 'publicKey']
                    }]
                });

                /**
                 * Count unread messages for this user.
                 *
                 * NOTE:
                 *  - `seenBy` is stored as JSONB (array of userId strings)
                 *  - Earlier we tried to use `array_position` in SQL, which fails on jsonb
                 *  - To keep things simple and compatible across DB setups, we load ids in JS
                 */
                const messagesForConv = await Message.findAll({
                    attributes: ['id', 'senderId', 'seenBy'],
                    where: { conversationId: conv.id }
                });

                const unreadCount = messagesForConv.filter(m => {
                    const senderId = String(m.senderId);
                    const seenBy = Array.isArray(m.seenBy) ? m.seenBy.map(String) : [];
                    return senderId !== String(req.user.id) && !seenBy.includes(String(req.user.id));
                }).length;

                return { ...fullConv.toJSON(), unreadCount };
            })
        );

        // Filter out lobby groups
        const final = populatedConversations.filter(c =>
            !(c.type === 'group' && (String(c.name || '').trim().toLowerCase() === 'lobby'))
        );

        // Add _id and normalize for backward compatibility
        const finalWithIds = adaptToFrontend(final);

        res.json(finalWithIds);
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const getConversationById = async (req, res) => {
    try {
        const conv = await Conversation.findByPk(req.params.id, {
            include: [{
                model: User,
                as: 'Members',
                attributes: ['id', 'username', 'email', 'avatar', 'status', 'lastSeenAt', 'publicKey']
            }]
        });

        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const isMember = conv.Members.some(m => String(m.id) === String(req.user.id));
        if (!isMember) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = adaptToFrontend(conv);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

export const createDirectConversation = async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
        // Check if conversation already exists
        const existingConvs = await Conversation.findAll({
            where: { type: 'direct' },
            include: [{
                model: User,
                as: 'Members',
                where: { id: { [Op.in]: [req.user.id, userId] } },
                through: { attributes: [] }
            }]
        });

        let conv = existingConvs.find(c => c.Members.length === 2);
        let isNew = false;

        if (!conv) {
            conv = await Conversation.create({ type: 'direct' });
            // Deduplicate IDs to avoid unique constraint if someone tries to chat with themselves
            const members = [...new Set([req.user.id, userId])];
            await conv.addMembers(members);
            isNew = true;
        } else {
            // Unhide if hidden
            await ConversationMember.update(
                { hidden: false },
                {
                    where: {
                        ConversationId: conv.id,
                        UserId: req.user.id,
                        hidden: true
                    }
                }
            );
        }

        const populated = await Conversation.findByPk(conv.id, {
            include: [{
                model: User,
                as: 'Members',
                attributes: ['id', 'username', 'email', 'avatar', 'status', 'lastSeenAt', 'publicKey']
            }]
        });

        const io = req.app.get('io');
        if (isNew && io) {
            populated.Members.forEach(member => {
                if (String(member.id) !== String(req.user.id)) {
                    io.to(`user:${member.id}`).emit('conversation_created', populated);
                }
            });
        }

        const result = adaptToFrontend(populated);
        res.json(result);
    } catch (error) {
        console.error('Create direct conversation error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const createGroupConversation = async (req, res) => {
    const { name, memberIds } = req.body;
    if (!name || !Array.isArray(memberIds) || memberIds.length < 2) {
        return res.status(400).json({ error: 'name and at least 2 members required' });
    }

    try {
        const conv = await Conversation.create({ type: 'group', name });
        await conv.addMembers([req.user.id, ...memberIds]);

        const populated = await Conversation.findByPk(conv.id, {
            include: [{
                model: User,
                as: 'Members',
                attributes: ['id', 'username', 'email', 'avatar', 'status', 'lastSeenAt', 'publicKey']
            }]
        });

        const io = req.app.get('io');
        if (io) {
            populated.Members.forEach(member => {
                if (String(member.id) !== String(req.user.id)) {
                    io.to(`user:${member.id}`).emit('conversation_created', populated);
                }
            });
        }

        const result = adaptToFrontend(populated);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const messages = await Message.findAll({
            where: { conversationId },
            include: [
                {
                    model: User,
                    as: 'Sender',
                    attributes: ['id', 'username', 'email', 'avatar']
                },
                {
                    model: Message,
                    as: 'ReplyTo',
                    include: [{
                        model: User,
                        as: 'Sender',
                        attributes: ['id', 'username']
                    }]
                }
            ],
            order: [['createdAt', 'ASC']]
        });

        const safeMessages = messages.map(m => toSafeMessage(m, req));
        const filtered = safeMessages.filter(msg => msg.content || (msg.attachments && msg.attachments.length > 0));
        const result = adaptToFrontend(filtered);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const deleteConversation = async (req, res) => {
    try {
        const conv = await Conversation.findByPk(req.params.id, {
            include: [{ model: User, as: 'Members' }]
        });

        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const isMember = conv.Members.some(m => String(m.id) === String(req.user.id));
        if (!isMember) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await Message.destroy({ where: { conversationId: req.params.id } });
        await conv.destroy();

        const io = req.app.get('io');
        if (io) {
            conv.Members.forEach(member => {
                io.to(`user:${member.id}`).emit('conversation_deleted', { conversationId: req.params.id });
            });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const clearConversation = async (req, res) => {
    try {
        const conv = await Conversation.findByPk(req.params.id, {
            include: [{ model: User, as: 'Members' }]
        });

        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const isMember = conv.Members.some(m => String(m.id) === String(req.user.id));
        if (!isMember) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const leaveConversation = async (req, res) => {
    try {
        const conv = await Conversation.findByPk(req.params.id, {
            include: [{ model: User, as: 'Members' }]
        });

        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const isMember = conv.Members.some(m => String(m.id) === String(req.user.id));
        if (!isMember) {
            return res.status(403).json({ error: 'Not a member' });
        }

        const io = req.app.get('io');

        if (conv.type === 'group') {
            await conv.removeMembers([req.user.id]);

            if (io) {
                conv.Members.forEach(member => {
                    if (String(member.id) !== String(req.user.id)) {
                        io.to(`user:${member.id}`).emit('member_left', {
                            conversationId: req.params.id,
                            userId: req.user.id
                        });
                    }
                });
            }
        } else {
            // For direct conversations, mark as hidden
            await ConversationMember.update(
                { hidden: true },
                {
                    where: {
                        ConversationId: req.params.id,
                        UserId: req.user.id
                    }
                }
            );
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const addMember = async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        const conv = await Conversation.findByPk(req.params.id, {
            include: [{ model: User, as: 'Members' }]
        });

        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        if (conv.type !== 'group') return res.status(400).json({ error: 'Can only add members to groups' });

        const isMember = conv.Members.some(m => String(m.id) === String(req.user.id));
        if (!isMember) return res.status(403).json({ error: 'Not authorized' });

        const alreadyMember = conv.Members.some(m => String(m.id) === String(userId));
        if (!alreadyMember) {
            await conv.addMembers([userId]);
        }

        const populated = await Conversation.findByPk(conv.id, {
            include: [{
                model: User,
                as: 'Members',
                attributes: ['id', 'username', 'email', 'avatar', 'status', 'lastSeenAt', 'publicKey']
            }]
        });

        const io = req.app.get('io');
        if (io) {
            populated.Members.forEach(member => {
                io.to(`user:${member.id}`).emit('member_added', {
                    conversationId: req.params.id,
                    userId,
                    conversation: populated
                });
            });

            io.to(`user:${userId}`).emit('invited_to_group', {
                conversationId: req.params.id,
                invitedBy: req.user.username,
                conversation: populated
            });
        }

        res.json({ success: true, conversation: populated });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const inviteToCall = async (req, res) => {
    try {
        const { userId, callId, type } = req.body;
        if (!userId || !callId) return res.status(400).json({ error: 'userId and callId required' });

        const conv = await Conversation.findByPk(req.params.id, {
            include: [{
                model: User,
                as: 'Members',
                attributes: ['id', 'username', 'email', 'avatar']
            }]
        });

        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const isMember = conv.Members.some(m => String(m.id) === String(req.user.id));
        if (!isMember) return res.status(403).json({ error: 'Not a member of this conversation' });

        const io = req.app.get('io');
        if (io) {
            io.to(`user:${userId}`).emit('call_incoming', {
                callId,
                conversationId: conv.id,
                from: req.user,
                conversation: conv,
                type: type || 'audio'
            });
        }

        res.json({ success: true, message: 'Invitation sent' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const removeMember = async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        const conv = await Conversation.findByPk(req.params.id, {
            include: [{ model: User, as: 'Members' }]
        });

        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        if (conv.type !== 'group') return res.status(400).json({ error: 'Can only remove members from groups' });

        const isGroupAdmin = conv.Members.length > 0 && String(conv.Members[0].id) === String(req.user.id);
        const isSystemAdmin = req.user.isAdmin;
        if (!isGroupAdmin && !isSystemAdmin) {
            return res.status(403).json({ error: 'Only group admin or system admin can remove members' });
        }

        const isMember = conv.Members.some(m => String(m.id) === String(userId));
        if (!isMember) return res.status(400).json({ error: 'User is not a member' });
        if (String(userId) === String(req.user.id)) {
            return res.status(400).json({ error: 'Cannot remove yourself, use leave group' });
        }

        await conv.removeMembers([userId]);

        const io = req.app.get('io');
        if (io) {
            io.to(`user:${userId}`).emit('member_removed', { conversationId: req.params.id, userId: userId });
            conv.Members.forEach(member => {
                if (String(member.id) !== String(userId)) {
                    io.to(`user:${member.id}`).emit('member_removed', { conversationId: req.params.id, userId: userId });
                }
            });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const sendMessage = async (req, res) => {
    try {
        const { conversationId, messageText, fileId, fileURL, fileName, fileType, fileSize, thumbnailURL, replyTo } = req.body;
        if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });

        const conv = await Conversation.findByPk(conversationId, {
            include: [{ model: User, as: 'Members' }]
        });

        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const isMember = conv.Members.some(m => String(m.id) === String(req.user.id));
        if (!isMember) {
            return res.status(403).json({ error: 'Not a member of this conversation' });
        }

        let attachments = [];
        if (fileId && fileURL) {
            const session = await UploadSession.findOne({
                where: {
                    fileId,
                    userId: req.user.id,
                    uploaded: true
                }
            });

            if (!session) return res.status(400).json({ error: 'File not found or not uploaded' });

            attachments = [{
                fileId: String(fileId),
                fileURL: String(fileURL || session.fileURL),
                name: String(fileName || session.fileName),
                type: String(fileType || session.fileType),
                size: Number(fileSize || session.fileSize),
                thumbnailURL: thumbnailURL ? String(thumbnailURL) : null
            }];
        }

        const content = messageText || '';
        const encContent = content ? encryptText(content) : '';
        const tempId = Math.random().toString(36).slice(2);

        const attachmentsArray = attachments || [];
        const cleanAttachments = attachmentsArray.map(att => {
            if (typeof att === 'string') {
                try { att = JSON.parse(att); } catch (e) { return null; }
            }
            return {
                fileId: String(att.fileId || ''),
                fileURL: String(att.fileURL || att.url || ''),
                name: String(att.name || 'file'),
                type: String(att.type || 'application/octet-stream'),
                size: Number(att.size || 0),
                thumbnailURL: att.thumbnailURL ? String(att.thumbnailURL) : null
            };
        }).filter(att => att && att.fileId);

        const msg = await Message.create({
            conversationId: conversationId,
            senderId: req.user.id,
            contentEnc: encContent,
            tempId,
            attachments: cleanAttachments,
            replyToId: replyTo || null
        });

        await conv.update({
            lastMessageAt: new Date()
        });

        // Reset hidden status for all members
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
                    as: 'ReplyTo',
                    include: [{
                        model: User,
                        as: 'Sender',
                        attributes: ['id', 'username']
                    }]
                }
            ]
        });

        const safe = toSafeMessage(populated, req);

        const finalResult = adaptToFrontend(safe);

        const io = req.app.get('io');
        if (io) {
            io.to(`conv:${conversationId}`).emit('message_new', finalResult);
        }

        res.json(finalResult);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
};

export const editMessage = async (req, res) => {
    try {
        const { content } = req.body || {};
        if (!content || !String(content).trim()) return res.status(400).json({ error: 'content required' });

        const msg = await Message.findByPk(req.params.id);
        if (!msg) return res.status(404).json({ error: 'Message not found' });
        if (String(msg.senderId) !== String(req.user.id)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const encContent = encryptText(content);
        await msg.update({
            contentEnc: encContent,
            editedAt: new Date()
        });

        const safe = toSafeMessage(msg, req);
        const finalResult = adaptToFrontend(safe);
        const io = req.app.get('io');
        if (io) {
            io.to(`conv:${msg.conversationId}`).emit('message_update', {
                messageId: String(msg.id),
                content: finalResult.content,
                editedAt: msg.editedAt
            });
        }

        res.json(finalResult);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const deleteMessage = async (req, res) => {
    try {
        const msg = await Message.findByPk(req.params.id);
        if (!msg) return res.status(404).json({ error: 'Message not found' });
        if (String(msg.senderId) !== String(req.user.id)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const conversationId = msg.conversationId;
        await msg.destroy();

        const io = req.app.get('io');
        if (io) {
            io.to(`conv:${conversationId}`).emit('message_deleted', {
                messageId: req.params.id,
                conversationId: conversationId
            });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

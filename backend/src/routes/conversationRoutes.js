
import express from 'express';
import {
    getConversations, getConversationById, createDirectConversation, createGroupConversation,
    deleteConversation, clearConversation, leaveConversation, addMember, removeMember, inviteToCall
} from '../controllers/chatController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateJWT, getConversations);
router.get('/:id', authenticateJWT, getConversationById);
router.post('/direct', authenticateJWT, createDirectConversation);
router.post('/group', authenticateJWT, createGroupConversation);
router.delete('/:id', authenticateJWT, deleteConversation);
router.post('/:id/clear', authenticateJWT, clearConversation);
router.post('/:id/leave', authenticateJWT, leaveConversation);
router.post('/:id/add-member', authenticateJWT, addMember);
router.post('/:id/call-invite', authenticateJWT, inviteToCall);
router.post('/:id/remove-member', authenticateJWT, removeMember);

export default router;

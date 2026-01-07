
import express from 'express';
import { getMessages, editMessage, deleteMessage, sendMessage } from '../controllers/chatController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

// /api/messages/:conversationId (GET) - Wait, collision with :id?
// Original: app.get('/api/messages/:conversationId', ...)
// Original: app.put('/api/messages/:id', ...)
// Original: app.delete('/api/messages/:id', ...)
// Original: app.post('/api/messages/send', ...)

// If I mount at /api/messages:
// GET /:conversationId - Works if conversationId is the only param.
// PUT /:id - Works.
// POST /send - Must be defined BEFORE /:conversationId to avoid 'send' being treated as ID.

router.post('/send', authenticateJWT, sendMessage);
router.get('/:conversationId', authenticateJWT, getMessages); // This matches /:id too effectively, so order matters.
router.put('/:id', authenticateJWT, editMessage);
router.delete('/:id', authenticateJWT, deleteMessage);

export default router;

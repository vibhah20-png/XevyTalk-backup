import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { getCallHistory, logCall, markCallViewed, getUnreadCallCount, markAllCallsViewed } from '../controllers/callController.js';

const router = express.Router();

router.get('/', authenticateJWT, getCallHistory);
router.post('/', authenticateJWT, logCall);
router.put('/:callId/viewed', authenticateJWT, markCallViewed);
router.get('/unread/count', authenticateJWT, getUnreadCallCount);
router.put('/mark-all-viewed', authenticateJWT, markAllCallsViewed);

export default router;

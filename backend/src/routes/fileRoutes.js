
import express from 'express';
import { getFile } from '../controllers/mediaController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

router.get('/:fileId', authenticateJWT, getFile);

export default router;

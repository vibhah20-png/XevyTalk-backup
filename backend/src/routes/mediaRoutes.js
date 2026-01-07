
import express from 'express';
import { createUploadSession, uploadFile, getFile } from '../controllers/mediaController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// Defined in index.js:
// app.post('/api/media/create-upload-session', ...)
// app.post('/api/media/upload/:sessionId', ...)
// app.get('/api/files/:fileId', ...) -> This fits in mediaController but path is /api/files.

// So:
// mediaRoutes mounted at /api/media
router.post('/create-upload-session', authenticateJWT, createUploadSession);
router.post('/upload/:sessionId', authenticateJWT, upload.single('file'), uploadFile);

export default router;


import express from 'express';
import { updateStatus, updateKeys, updateProfile, getAllUsers, getUserById, adminCreateUser, adminGetUsers } from '../controllers/userController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

router.post('/status', authenticateJWT, updateStatus);
router.put('/keys', authenticateJWT, updateKeys);
router.put('/me', authenticateJWT, updateProfile); // Matches /api/users/me
router.get('/', authenticateJWT, getAllUsers); // Matches /api/users
router.get('/:id', authenticateJWT, getUserById);
router.post('/admin/create-user', authenticateJWT, adminCreateUser); // Matches /api/admin/create-user (Wait, in index.js it was /api/admin/create-user. Here I should mount at /api? or /api/users?)
// In index.js: app.post('/api/admin/create-user'...)
// I can put admin routes in a separate file or just include them here. 
// If I mount this router at /api/users, then /api/users/admin/create-user would be the path. 
// Standard practice: keep original paths.
// I'll create an `adminRoutes.js` or just handle it in main index.
// I'll duplicate the route definitions to match original EXACTLY in `index.js`, 
// bu actually, Express allow mounting at /api.
// Let's create `adminRoutes.js` for admin stuff?
// No, the user controller has admin functions.
// I'll separate them in index.js by mounting paths differently or just define these specific routes.
// "router.post('/admin/create-user')" if mounted at "/api/users" becomes "/api/users/admin/create-user".
// Original was "/api/admin/create-user".
// So I should probably have an `adminRoutes.js`.

// Let's stick to:
// /api/users (GET)
// /api/users/me (PUT)
// /api/users/status (POST)
// /api/users/keys (PUT)

// Admin routes:
// /api/admin/create-user
// /api/admin/users
// I'll put these in `adminRoutes.js`.

export default router;

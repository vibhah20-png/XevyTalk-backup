
import express from 'express';
import { adminCreateUser, adminGetUsers } from '../controllers/userController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

router.post('/create-user', auth, adminCreateUser);
router.get('/users', auth, adminGetUsers);

export default router;

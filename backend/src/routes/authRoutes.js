
import express from 'express';
import { guestLogin, register, login, getMe, changePassword, forgotPassword, verifyOTP, resetPassword } from '../controllers/authController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

router.post('/guest', guestLogin);
router.post('/register', register);
router.post('/login', login);
router.get('/me', auth, getMe);
router.post('/change-password', auth, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

export default router;

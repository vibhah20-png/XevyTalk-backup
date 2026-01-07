
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import OTP from '../models/OTP.js';
import { signToken } from '../middleware/auth.js';
import { emailTransporter, sendWelcomeEmail } from '../utils/email.js';
import { adaptToFrontend } from '../utils/frontendAdapter.js';

export const guestLogin = async (req, res) => {
    const { username } = req.body || {};
    const name = username || `Guest ${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const u = await User.create({
        username: name,
        avatar: `https://api.dicebear.com/8.x/pixel-art/svg?seed=${encodeURIComponent(name)}`
    });
    res.json(adaptToFrontend(u));
};

export const register = async (req, res) => {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (normalizedEmail !== 'admin@xevyte.com') {
        return res.status(403).json({ error: 'Registration is disabled. Please contact admin for account creation.' });
    }

    const exists = await User.findOne({ where: { email } });
    if (exists) {
        return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const u = await User.create({
        username: name,
        email,
        passwordHash,
        avatar: `https://api.dicebear.com/8.x/pixel-art/svg?seed=${encodeURIComponent(name)}`,
        isAdmin: true,
        createdByAdmin: false
    });
    const userData = u.toJSON();
    res.json({ token: signToken(u), user: adaptToFrontend(userData) });
};

export const login = async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    const u = await User.findOne({ where: { email } });
    if (!u || !u.passwordHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!u.createdByAdmin && !u.isAdmin) {
        return res.status(401).json({ error: 'Invalid credentials. Please contact admin for account creation.' });
    }

    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (email === 'admin@xevyte.com' && !u.isAdmin) {
        u.isAdmin = true;
        await u.save();
    }

    u.status = 'online';
    u.lastSeenAt = new Date();
    await u.save();

    const userData = u.toJSON();
    res.json({ token: signToken(u), user: adaptToFrontend(userData) });
};

export const getMe = async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: { exclude: ['passwordHash'] }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });
        const userData = user.toJSON();
        res.json(adaptToFrontend(userData));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
};

export const changePassword = async (req, res) => {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const passwordHash = await bcrypt.hash(newPassword, 10);
        user.passwordHash = passwordHash;
        user.mustChangePassword = false;
        await user.save();

        res.json({ message: 'Password updated successfully', user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update password' });
    }
};

export const forgotPassword = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
        if (!user) return res.status(404).json({ error: 'No account found with this email' });

        if (!user.createdByAdmin && !user.isAdmin) {
            return res.status(403).json({ error: 'Password reset is only available for admin-created accounts' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await OTP.destroy({ where: { email: email.toLowerCase().trim() } }); // clear old OTPs

        const otpDoc = await OTP.create({
            email: email.toLowerCase().trim(),
            otp,
            expiresAt: new Date(Date.now() + 600000)
        });

        const mailOptions = {
            from: `"XevyTalk Support" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Password Reset OTP - XevyTalk',
            text: `Your OTP is: ${otp}`
        };

        await emailTransporter.sendMail(mailOptions);
        res.json({ message: 'OTP sent to your email', email });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to process password reset request' });
    }
};

export const verifyOTP = async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    try {
        const otpDoc = await OTP.findOne({
            where: {
                email: email.toLowerCase().trim(),
                otp: otp.trim()
            }
        });

        if (!otpDoc) return res.status(400).json({ error: 'Invalid OTP' });
        if (new Date() > otpDoc.expiresAt) {
            await otpDoc.destroy();
            return res.status(400).json({ error: 'OTP has expired' });
        }

        otpDoc.verified = true;
        await otpDoc.save();
        res.json({ message: 'OTP verified successfully', email });
    } catch (error) {
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
};

export const resetPassword = async (req, res) => {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ error: 'All fields required' });

    try {
        const otpDoc = await OTP.findOne({
            where: {
                email: email.toLowerCase().trim(),
                otp: otp.trim(),
                verified: true
            }
        });
        if (!otpDoc) return res.status(400).json({ error: 'Invalid or unverified OTP' });

        const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        user.mustChangePassword = false;
        await user.save();
        await otpDoc.destroy();

        res.json({ message: 'Password reset successful' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reset password' });
    }
};

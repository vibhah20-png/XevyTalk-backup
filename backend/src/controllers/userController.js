
import User from '../models/User.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { sendWelcomeEmail } from '../utils/email.js';
import { adaptToFrontend } from '../utils/frontendAdapter.js';
import { Op } from 'sequelize';

export const updateStatus = async (req, res) => {
    const { status } = req.body;
    if (!status || !['online', 'away', 'dnd'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.status = status;
        user.lastSeenAt = new Date();
        await user.save();

        const io = req.app.get('io');
        if (io) {
            io.emit('user_status_changed', {
                userId: user.id,
                status: user.status,
                lastSeenAt: user.lastSeenAt
            });
        }

        res.json({ message: 'Status updated', status: user.status });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update status' });
    }
};

export const updateKeys = async (req, res) => {
    const { publicKey } = req.body;
    if (!publicKey) return res.status(400).json({ error: 'Public Key required' });

    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.publicKey = publicKey;
        await user.save();

        const io = req.app.get('io');
        if (io) io.emit('user_key_update', { userId: req.user.id, publicKey });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update key' });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const allowed = ['email', 'phone', 'address', 'avatar', 'username'];
        const patch = {};
        for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        await user.update(patch);

        const { passwordHash, ...userWithoutPassword } = user.toJSON();
        res.json(userWithoutPassword);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

export const getAllUsers = async (req, res) => {
    const users = await User.findAll({
        order: [['createdAt', 'DESC']],
        limit: 50
    });

    // Add _id for backward compatibility with frontend
    const usersWithId = users.map(u => {
        const userData = u.toJSON();
        return { ...userData, _id: userData.id };
    });

    res.json(usersWithId);
};

export const getUserById = async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id, {
            attributes: { exclude: ['passwordHash'] }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const adminCreateUser = async (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Unauthorized' });
    const { username, email } = req.body;
    if (!username || !email) return res.status(400).json({ error: 'Username and email required' });

    try {
        const exists = await User.findOne({ where: { email } });
        if (exists) return res.status(409).json({ error: 'Email already registered' });

        const randomPassword = crypto.randomBytes(4).toString('hex');
        const passwordHash = await bcrypt.hash(randomPassword, 10);

        const newUser = await User.create({
            username,
            email,
            passwordHash,
            avatar: `https://api.dicebear.com/8.x/pixel-art/svg?seed=${encodeURIComponent(username)}`,
            isAdmin: false,
            createdByAdmin: true,
            mustChangePassword: true,
            status: 'offline',
            lastSeenAt: null
        });

        const emailSent = await sendWelcomeEmail(email, username, randomPassword);
        const { passwordHash: _, ...u } = newUser.toJSON();
        res.json({ user: u, password: randomPassword, emailSent });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const adminGetUsers = async (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Unauthorized' });
    const users = await User.findAll({
        where: { createdByAdmin: true },
        attributes: { exclude: ['passwordHash'] },
        order: [['username', 'ASC']]
    });

    // Add _id and normalize for backward compatibility
    res.json(adaptToFrontend(users));
};

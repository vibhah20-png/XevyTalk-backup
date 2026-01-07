import CallHistory from '../models/CallHistory.js';
import User from '../models/User.js';
import { adaptToFrontend } from '../utils/frontendAdapter.js';
import { Op } from 'sequelize';

export const getCallHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const history = await CallHistory.findAll({
            where: {
                [Op.or]: [
                    { callerId: userId },
                    { calleeId: userId }
                ]
            },
            include: [
                {
                    model: User,
                    as: 'Caller',
                    attributes: ['id', 'username', 'email', 'avatar']
                },
                {
                    model: User,
                    as: 'Callee',
                    attributes: ['id', 'username', 'email', 'avatar']
                }
            ],
            order: [['startTime', 'DESC']],
            limit: 50
        });
        res.json(adaptToFrontend(history));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const logCall = async (req, res) => {
    try {
        const { callerId, calleeId, type, status, duration } = req.body;
        // Basic validation
        if (!callerId || !calleeId) return res.status(400).json({ error: 'Caller and Callee required' });

        const call = await CallHistory.create({
            callerId: callerId,
            calleeId: calleeId,
            type: type || 'audio',
            status,
            duration: duration || 0,
            endTime: (status === 'completed' && duration) ? new Date() : null
        });
        res.json(adaptToFrontend(call));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const markCallViewed = async (req, res) => {
    try {
        const { callId } = req.params;
        await CallHistory.update(
            { viewed: true },
            { where: { id: callId } }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const getUnreadCallCount = async (req, res) => {
    try {
        const userId = req.user.id;
        const count = await CallHistory.count({
            where: {
                calleeId: userId,
                viewed: false
            }
        });
        res.json({ count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const markAllCallsViewed = async (req, res) => {
    try {
        const userId = req.user.id;
        await CallHistory.update(
            { viewed: true },
            {
                where: {
                    calleeId: userId,
                    viewed: false
                }
            }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};


import { decryptText } from './encryption.js';

export const toSafeMessage = (m, req = null) => {
    if (!m) return m;
    // Support both Sequelize (toJSON) and Mongoose (toObject)
    const obj = m.toJSON ? m.toJSON() : (m.toObject ? m.toObject() : { ...m });

    if (obj.contentEnc) {
        const decrypted = decryptText(obj.contentEnc);
        if (decrypted) obj.content = decrypted;
    }

    // Decrypt nested replyTo message content if present
    const reply = obj.replyTo || obj.ReplyTo;
    if (reply && reply.contentEnc) {
        const decrypted = decryptText(reply.contentEnc);
        if (decrypted) reply.content = decrypted;
    }

    // Add URLs to attachments if they exist
    if (obj.attachments && obj.attachments.length > 0) {
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const PORT = process.env.PORT || 4000;

        // Use BACKEND_URL from env if available, otherwise get from request, finally fallback to dynamic host
        let host = process.env.BACKEND_URL;
        if (!host && req) {
            host = req.get('host');
        }
        if (!host) {
            host = `13.205.101.250:${PORT}`;
        }

        // Remove protocol if present in host string to avoid double protocol
        host = host.replace(/^https?:\/\//, '');

        obj.attachments = obj.attachments.map(att => ({
            fileId: att.fileId,
            fileURL: att.fileURL || att.url || `${protocol}://${host}/api/files/${att.fileId}`,
            url: att.fileURL || att.url || `${protocol}://${host}/api/files/${att.fileId}`, // For backward compatibility
            name: att.name,
            type: att.type,
            size: att.size,
            thumbnailURL: att.thumbnailURL || null
        }));
    }
    return obj;
};

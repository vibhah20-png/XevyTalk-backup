import '../env.js';
import crypto from 'crypto';

const ENC_ALGO = 'aes-256-gcm';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-prod';
const ENC_KEY = crypto
    .createHash('sha256')
    .update(process.env.MESSAGE_ENC_SECRET || JWT_SECRET || 'fallback-message-secret')
    .digest(); // 32 bytes

export const encryptText = (plain = '') => {
    if (!plain) return '';
    const iv = crypto.randomBytes(12); // recommended size for GCM
    const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Store as base64(iv):base64(tag):base64(cipherText)
    return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
};

export const decryptText = (packed = '') => {
    if (!packed) return '';
    try {
        const [ivB64, tagB64, dataB64] = String(packed).split(':');
        if (!ivB64 || !tagB64 || !dataB64) return '';
        const iv = Buffer.from(ivB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const data = Buffer.from(dataB64, 'base64');
        const decipher = crypto.createDecipheriv(ENC_ALGO, ENC_KEY, iv);
        decipher.setAuthTag(tag);
        const dec = Buffer.concat([decipher.update(data), decipher.final()]);
        return dec.toString('utf8');
    } catch (e) {
        console.error('Failed to decrypt message content', e.message);
        return '';
    }
};

export const encryptFileBuffer = (fileBuffer) => {
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, iv);
        const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
        const tag = cipher.getAuthTag();
        return { iv, tag, encrypted };
    } catch (e) {
        console.error('File encryption error:', e.message);
        throw e;
    }
};

export const decryptFileBuffer = (iv, tag, encryptedBuffer) => {
    try {
        const decipher = crypto.createDecipheriv(ENC_ALGO, ENC_KEY, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
        return decrypted;
    } catch (e) {
        console.error('File decryption error:', e.message);
        throw e;
    }
};

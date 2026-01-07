
import UploadSession from '../models/UploadSession.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encryptFileBuffer, decryptFileBuffer } from '../utils/encryption.js';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '../middleware/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export const createUploadSession = async (req, res) => {
    try {
        const { fileName, fileType, fileSize } = req.body;

        if (!fileName || !fileType || !fileSize) {
            return res.status(400).json({ error: 'fileName, fileType, and fileSize are required' });
        }

        if (fileSize > MAX_FILE_SIZE) {
            return res.status(400).json({ error: `File size exceeds maximum limit of ${MAX_FILE_SIZE / 1024 / 1024}MB` });
        }

        if (!ALLOWED_FILE_TYPES.includes(fileType)) {
            return res.status(400).json({ error: `File type ${fileType} not allowed` });
        }

        const sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const session = await UploadSession.create({
            sessionId,
            userId: req.user.id,
            fileName,
            fileType,
            fileSize
        });

        const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
        const host = req.get('host');

        const uploadURL = `${protocol}://${host}/api/media/upload/${sessionId}`;
        const finalFileURL = `${protocol}://${host}/api/files/${sessionId}`;

        res.json({
            sessionId,
            uploadURL,
            finalFileURL,
            fileId: sessionId,
            expiresAt: session.expiresAt
        });
    } catch (error) {
        console.error('Error creating upload session:', error);
        res.status(500).json({ error: 'Failed to create upload session' });
    }
};

export const uploadFile = async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const session = await UploadSession.findOne({
            where: {
                sessionId,
                userId: req.user.id
            }
        });

        if (!session) return res.status(404).json({ error: 'Upload session not found or expired' });
        if (session.uploaded) return res.status(400).json({ error: 'File already uploaded for this session' });
        if (new Date() > session.expiresAt) return res.status(400).json({ error: 'Upload session expired' });

        if (req.file.size !== session.fileSize || req.file.mimetype !== session.fileType) {
            return res.status(400).json({ error: 'File does not match session parameters' });
        }

        const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${session.fileName}`;
        const filePath = path.join(UPLOAD_DIR, filename);

        // Encrypt file
        const { iv, tag, encrypted } = encryptFileBuffer(req.file.buffer);

        // Store encrypted file with metadata
        const fileData = {
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            originalName: session.fileName,
            mimeType: session.fileType,
            uploadedBy: String(req.user.id),
            uploadedAt: new Date().toISOString(),
            sessionId: sessionId,
            encrypted: true
        };

        // Write metadata as JSON header + encrypted data
        const metadataStr = JSON.stringify(fileData) + '\n---FILEDATA---\n';
        const metadataBuffer = Buffer.from(metadataStr, 'utf8');
        const finalBuffer = Buffer.concat([metadataBuffer, encrypted]);

        fs.writeFileSync(filePath, finalBuffer);

        const fileId = filename;
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
        const host = req.get('host');
        const fileURL = `${protocol}://${host}/api/files/${fileId}`;

        session.uploaded = true;
        session.fileId = fileId;
        session.fileURL = fileURL;
        await session.save();

        res.json({
            success: true,
            fileId,
            fileURL,
            fileName: session.fileName,
            fileType: session.fileType,
            fileSize: session.fileSize
        });

    } catch (error) {
        console.error('Upload error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to upload file' });
    }
};

export const getFile = async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const filePath = path.join(UPLOAD_DIR, fileId);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const fileBuffer = fs.readFileSync(filePath);
        const fileContent = fileBuffer.toString('utf8');

        // Check if file has metadata header
        if (fileContent.includes('---FILEDATA---')) {
            const [metadataStr, ...rest] = fileContent.split('---FILEDATA---\n');
            const metadata = JSON.parse(metadataStr);

            // Get encrypted data (everything after the separator)
            const separatorIndex = fileBuffer.indexOf('---FILEDATA---\n') + '---FILEDATA---\n'.length;
            const encryptedBuffer = fileBuffer.slice(separatorIndex);

            try {
                const iv = Buffer.from(metadata.iv, 'base64');
                const tag = Buffer.from(metadata.tag, 'base64');
                const decryptedBuffer = decryptFileBuffer(iv, tag, encryptedBuffer);

                const mime = metadata.mimeType || 'application/octet-stream';
                const isViewable = mime.startsWith('image/') || mime.startsWith('video/') ||
                    mime.startsWith('audio/') || mime === 'application/pdf';
                const disposition = isViewable ? 'inline' : 'attachment';

                res.set('Content-Type', mime);
                res.set('Content-Disposition', `${disposition}; filename="${encodeURIComponent(metadata.originalName)}"`);
                res.set('Content-Length', decryptedBuffer.length);
                res.send(decryptedBuffer);
            } catch (e) {
                console.error('Decryption failed', e);
                res.status(500).json({ error: 'Failed to decrypt file' });
            }
        } else {
            // Unencrypted file (legacy or direct upload)
            const mime = 'application/octet-stream';
            res.set('Content-Type', mime);
            res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileId)}"`);
            res.send(fileBuffer);
        }
    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to download file' });
    }
};

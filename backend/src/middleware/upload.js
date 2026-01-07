
import multer from 'multer';

// File upload limits and allowed types
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_FILE_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'video/mp4', 'video/quicktime', 'video/x-msvideo',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
    'text/plain', 'text/csv'
];

export const cleanupUploads = (req, res, next) => {
    // Helper to cleanup memory if needed, handled by GC mostly for memory storage
    next();
};

export const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`), false);
        }
    }
});

export { MAX_FILE_SIZE, ALLOWED_FILE_TYPES };

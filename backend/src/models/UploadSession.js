
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './User.js';

const UploadSession = sequelize.define('UploadSession', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    sessionId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    fileName: {
        type: DataTypes.STRING
    },
    fileType: {
        type: DataTypes.STRING
    },
    fileSize: {
        type: DataTypes.INTEGER
    },
    expiresAt: {
        type: DataTypes.DATE,
        defaultValue: () => new Date(Date.now() + 3600000) // 1 hour expiry
    },
    uploaded: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    fileId: {
        type: DataTypes.STRING
    },
    fileURL: {
        type: DataTypes.STRING
    }
}, {
    timestamps: true
});

UploadSession.belongsTo(User, { foreignKey: 'userId', as: 'User' });

export default UploadSession;

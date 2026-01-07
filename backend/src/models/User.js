
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    avatar: {
        type: DataTypes.STRING
    },
    lastSeenAt: {
        type: DataTypes.DATE,
        defaultValue: null
    },
    passwordHash: {
        type: DataTypes.STRING
    },
    phone: {
        type: DataTypes.STRING
    },
    address: {
        type: DataTypes.STRING
    },
    isAdmin: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    createdByAdmin: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    mustChangePassword: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    status: {
        type: DataTypes.ENUM('online', 'away', 'dnd', 'in_call', 'offline'),
        defaultValue: 'offline'
    },
    publicKey: {
        type: DataTypes.TEXT // Base64 can be long
    }
}, {
    timestamps: true
});

export default User;

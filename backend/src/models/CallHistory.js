
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './User.js';

const CallHistory = sequelize.define('CallHistory', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    type: {
        type: DataTypes.ENUM('audio', 'video'),
        defaultValue: 'audio'
    },
    status: {
        type: DataTypes.ENUM('completed', 'missed', 'rejected', 'busy'),
        allowNull: false
    },
    startTime: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    endTime: {
        type: DataTypes.DATE
    },
    duration: {
        type: DataTypes.INTEGER,
        defaultValue: 0 // in seconds
    },
    viewed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    timestamps: true
});

CallHistory.belongsTo(User, { foreignKey: 'callerId', as: 'Caller' });
CallHistory.belongsTo(User, { foreignKey: 'calleeId', as: 'Callee' });

export default CallHistory;

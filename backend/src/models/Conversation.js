
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './User.js';

const Conversation = sequelize.define('Conversation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    type: {
        type: DataTypes.ENUM('direct', 'group'),
        allowNull: false
    },
    name: {
        type: DataTypes.STRING
    },
    lastMessageAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: true
});

// Junction table for members
export const ConversationMember = sequelize.define('ConversationMember', {
    hidden: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, { timestamps: false });

User.belongsToMany(Conversation, { through: ConversationMember, as: 'Conversations' });
Conversation.belongsToMany(User, { through: ConversationMember, as: 'Members' });

export default Conversation;

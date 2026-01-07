
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './User.js';
import Conversation from './Conversation.js';

const Message = sequelize.define('Message', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    content: {
        type: DataTypes.TEXT
    },
    contentEnc: {
        type: DataTypes.TEXT
    },
    tempId: {
        type: DataTypes.STRING
    },
    attachments: {
        type: DataTypes.JSONB,
        defaultValue: []
    },
    editedAt: {
        type: DataTypes.DATE
    },
    deliveredTo: {
        type: DataTypes.JSONB, // Array of User IDs
        defaultValue: []
    },
    seenBy: {
        type: DataTypes.JSONB, // Array of User IDs
        defaultValue: []
    }
}, {
    timestamps: true
});

Message.belongsTo(Conversation, { foreignKey: 'conversationId', as: 'Conversation' });
Message.belongsTo(User, { foreignKey: 'senderId', as: 'Sender' });
Message.belongsTo(Message, { foreignKey: 'replyToId', as: 'ReplyTo' });

export default Message;

/**
 * Utility functions for adapting PostgreSQL/Sequelize data structures
 * to remain compatible with the existing frontend format.
 */

/**
 * Adds an '_id' alias for 'id' and normalizes association names.
 * This ensures the frontend (which was built for MongoDB) continues to work
 * without needing a complete rewrite of the UI logic.
 * 
 * @param {Object} obj - The data object from Sequelize/PostgreSQL
 * @returns {Object} - The adapted object
 */
export const adaptToFrontend = (obj) => {
    if (!obj) return obj;

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(adaptToFrontend);
    }

    // Handle Sequelize model instances vs plain objects
    let result = obj.toJSON ? obj.toJSON() : { ...obj };

    // Standard ID mapping: PostgreSQL 'id' -> Frontend '_id'
    if (result.id && !result._id) {
        result._id = result.id;
    }

    // Association Mapping: Capitalized (Sequelize) -> Lowercase (Expected by Frontend)
    // 1. Members -> members
    if (result.Members && !result.members) {
        result.members = adaptToFrontend(result.Members);
    } else if (result.members) {
        result.members = adaptToFrontend(result.members);
    }

    // 2. Sender -> sender
    if (result.Sender && !result.sender) {
        result.sender = adaptToFrontend(result.Sender);
    } else if (result.sender) {
        result.sender = adaptToFrontend(result.sender);
    }

    // 3. ReplyTo -> replyTo
    if (result.ReplyTo && !result.replyTo) {
        result.replyTo = adaptToFrontend(result.ReplyTo);
    } else if (result.replyTo) {
        result.replyTo = adaptToFrontend(result.replyTo);
    }

    // 4. Caller -> caller
    if (result.Caller && !result.caller) {
        result.caller = adaptToFrontend(result.Caller);
    } else if (result.caller) {
        result.caller = adaptToFrontend(result.caller);
    }

    // 5. Callee -> callee
    if (result.Callee && !result.callee) {
        result.callee = adaptToFrontend(result.Callee);
    } else if (result.callee) {
        result.callee = adaptToFrontend(result.callee);
    }

    // Recursively handle any other nested objects
    for (const key in result) {
        if (result[key] && typeof result[key] === 'object' &&
            !['members', 'sender', 'replyTo', 'caller', 'callee'].includes(key)) {
            // Avoid infinite loops and redundant processing for already handled keys
            if (!(result[key] instanceof Date)) {
                result[key] = adaptToFrontend(result[key]);
            }
        }
    }

    return result;
};

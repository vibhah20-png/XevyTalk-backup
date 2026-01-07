import User from '../models/User.js';
import sequelize from '../config/db.js';

async function run() {
    try {
        console.log('Resetting all user statuses to offline...');
        const [affectedCount] = await User.update(
            { status: 'offline' },
            { where: {} }
        );
        console.log(`Successfully reset ${affectedCount} users.`);
        process.exit(0);
    } catch (error) {
        console.error('Failed to reset statuses:', error);
        process.exit(1);
    }
}

run();

import '../env.js';
import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(
    process.env.DB_NAME || 'xevytalk',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false,

        // SSL is optional, set DB_SSL=true in .env to enable it
        dialectOptions: process.env.DB_SSL === 'true' ? {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        } : {},

        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    }
);

export const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('✓ Connected to PostgreSQL successfully');

        await sequelize.sync();
        console.log('✓ PostgreSQL models synchronized');
    } catch (error) {
        console.error('✗ Failed to connect to PostgreSQL:', error);
        process.exit(1);
    }
};

export default sequelize;

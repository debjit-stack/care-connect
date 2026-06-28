import dotenv from 'dotenv';

dotenv.config();

function required(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

const env = {
    APP_NAME: process.env.APP_NAME || 'CareConnect',

    MONGO_URI: required('MONGO_URI'),

    JWT_SECRET: required('JWT_SECRET'),
    JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
    JWT_MFA_PENDING_SECRET: required('JWT_MFA_PENDING_SECRET'),

    MFA_ENCRYPTION_KEY: required('MFA_ENCRYPTION_KEY'),

    REDIS_URL: required('REDIS_URL'),

    NODE_ENV: process.env.NODE_ENV || 'development',
};

if (!/^[0-9a-fA-F]{64}$/.test(env.MFA_ENCRYPTION_KEY)) {
    throw new Error(
        `MFA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters. Current length: ${env.MFA_ENCRYPTION_KEY.length}`
    );
}

export default env;
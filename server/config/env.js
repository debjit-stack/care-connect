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

    // B12 FIX: this was previously required('REDIS_URL'), which threw at
    // import time if REDIS_URL wasn't set — before redis.js's local fallback
    // (127.0.0.1:6379 with optional REDIS_HOST/PORT/USERNAME/PASSWORD) ever
    // got a chance to run. That made it impossible to start the server
    // locally without a Redis Cloud URL. REDIS_URL is now optional here;
    // redis.js's own fallback logic decides what to connect to.
    REDIS_URL: process.env.REDIS_URL || null,

    NODE_ENV: process.env.NODE_ENV || 'development',
};

if (!/^[0-9a-fA-F]{64}$/.test(env.MFA_ENCRYPTION_KEY)) {
    throw new Error(
        `MFA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters. Current length: ${env.MFA_ENCRYPTION_KEY.length}`
    );
}

export default env;

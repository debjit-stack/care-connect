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

    // PHASE2-H2 FIX: controls whether resolveTenant (tenantMiddleware.js)
    // and resolveOrgFromRequest (authController.js) are allowed to silently
    // auto-select "the one organisation that exists" when a request omits
    // the X-Organisation-Slug/-Id header and no subdomain resolves.
    //
    // Defaults to FALSE — secure/production-safe by default. When false,
    // any request that can't resolve an org from explicit client-supplied
    // metadata is rejected with 400 rather than guessing, REGARDLESS of how
    // many organisations currently exist (see H2 in the multi-tenant audit:
    // the previous count===1-only auto-pick meant behavior silently changed
    // the moment a second hospital was onboarded — a breaking change for any
    // client relying on the fallback, occurring exactly when multi-tenancy
    // starts to matter).
    //
    // Set ALLOW_SINGLE_ORG_AUTO_RESOLVE=true only for local/single-tenant
    // development convenience. Uses a strict string comparison so an unset
    // variable, empty string, or literal "false" all correctly evaluate to
    // disabled.
    ALLOW_SINGLE_ORG_AUTO_RESOLVE: process.env.ALLOW_SINGLE_ORG_AUTO_RESOLVE === 'true',

    NODE_ENV: process.env.NODE_ENV || 'development',
};

if (!/^[0-9a-fA-F]{64}$/.test(env.MFA_ENCRYPTION_KEY)) {
    throw new Error(
        `MFA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters. Current length: ${env.MFA_ENCRYPTION_KEY.length}`
    );
}

export default env;

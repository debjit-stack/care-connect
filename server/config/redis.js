import Redis from 'ioredis';

let client = null;

const getRedisClient = () => {
    if (client) return client;

    client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
    });

    client.on('connect', () => console.log('[Redis] connected'));
    client.on('error', (err) => {
        console.error('[Redis] connection error:', err.message);
    });

    return client;
};

export default getRedisClient;

import Redis from "ioredis";

let client = null;

const getRedisClient = () => {
    if (client) return client;

    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
        // Production / Redis Cloud
        client = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: true,
        });
    } else {
        // Local development fallback
        client = new Redis({
            host: process.env.REDIS_HOST || "127.0.0.1",
            port: Number(process.env.REDIS_PORT || 6379),
            username: process.env.REDIS_USERNAME || undefined,
            password: process.env.REDIS_PASSWORD || undefined,

            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: true,
        });
    }

    client.on("connect", () => {
        console.log("[Redis] connected");
    });

    client.on("ready", () => {
        console.log("[Redis] ready");
    });

    client.on("reconnecting", () => {
        console.warn("[Redis] reconnecting...");
    });

    client.on("end", () => {
        console.warn("[Redis] connection closed");
    });

    client.on("error", (err) => {
        console.error("[Redis]", err.message);
    });

    return client;
};

process.on("SIGINT", async () => {
    if (client) {
        await client.quit();
        console.log("[Redis] disconnected");
    }
    process.exit(0);
});

process.on("SIGTERM", async () => {
    if (client) {
        await client.quit();
        console.log("[Redis] disconnected");
    }
    process.exit(0);
});

export default getRedisClient;
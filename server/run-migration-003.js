import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { up } from './migrations/003-multi-tenancy.js';

const client = new MongoClient(process.env.MONGO_URI);

try {
    await client.connect();

    const db = client.db(); // Atlas database from connection string

    await up(db);

    console.log('Migration completed successfully');
} catch (err) {
    console.error(err);
} finally {
    await client.close();
}
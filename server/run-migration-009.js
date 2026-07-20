import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.join(__dirname, ".env"),
});
import { MongoClient } from 'mongodb';
import { up } from './migrations/009-global-email-uniqueness.js';

const client = new MongoClient(process.env.MONGO_URI);

try {
    await client.connect();
    const db = client.db();
    await up(db);
    console.log('Migration 009 completed successfully');
} catch (err) {
    console.error(err);
    process.exitCode = 1;
} finally {
    await client.close();
}

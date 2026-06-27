import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

async function run() {
  await mongoose.connect(MONGO_URI);

  console.log("Connected to MongoDB");

  const users = mongoose.connection.collection("users");

  // ------------------------------------------------------------------
  // lockUntil
  // ------------------------------------------------------------------
  const lockUntil = await users.updateMany(
    { lockUntil: { $exists: false } },
    { $set: { lockUntil: null } }
  );

  console.log(`lockUntil updated: ${lockUntil.modifiedCount}`);

  // ------------------------------------------------------------------
  // deletedAt
  // ------------------------------------------------------------------
  const deletedAt = await users.updateMany(
    { deletedAt: { $exists: false } },
    { $set: { deletedAt: null } }
  );

  console.log(`deletedAt updated: ${deletedAt.modifiedCount}`);

  // ------------------------------------------------------------------
  // mfaEnabled
  // ------------------------------------------------------------------
  const mfaEnabled = await users.updateMany(
    { mfaEnabled: { $exists: false } },
    { $set: { mfaEnabled: false } }
  );

  console.log(`mfaEnabled updated: ${mfaEnabled.modifiedCount}`);

  // ------------------------------------------------------------------
  // mfaSecret
  // ------------------------------------------------------------------
  const mfaSecret = await users.updateMany(
    { mfaSecret: { $exists: false } },
    { $set: { mfaSecret: null } }
  );

  console.log(`mfaSecret updated: ${mfaSecret.modifiedCount}`);

  // ------------------------------------------------------------------
  // passwordChangedAt
  // If missing, use createdAt.
  // ------------------------------------------------------------------
  const cursor = users.find({
    passwordChangedAt: { $exists: false }
  });

  let count = 0;

  while (await cursor.hasNext()) {
    const user = await cursor.next();

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordChangedAt: user.createdAt ?? new Date()
        }
      }
    );

    count++;
  }

  console.log(`passwordChangedAt updated: ${count}`);

  console.log("==================================");
  console.log("Migration 004 completed.");
  console.log("==================================");

  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
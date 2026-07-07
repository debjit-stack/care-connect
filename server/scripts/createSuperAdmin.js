import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "../models/User.js";

dotenv.config();

const createSuperAdmin = async () => {
    try {
        if (!process.env.MONGO_URI) {
            throw new Error("MONGO_URI is missing from .env");
        }

        if (
            !process.env.SUPER_ADMIN_NAME ||
            !process.env.SUPER_ADMIN_EMAIL ||
            !process.env.SUPER_ADMIN_PASSWORD
        ) {
            throw new Error(
                "SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env"
            );
        }

        await mongoose.connect(process.env.MONGO_URI);

        console.log("[DB] Connected");

        // Ignore tenant filtering when checking for an existing Super Admin
        const existing = await User.findOne({
            role: "super_admin",
            deletedAt: null,
        }).skipTenantFilter();

        if (existing) {
            console.log("\nA Super Admin already exists.");
            console.log(`Email: ${existing.email}`);
            process.exit(0);
        }

        const admin = await User.create({
            name: process.env.SUPER_ADMIN_NAME,
            email: process.env.SUPER_ADMIN_EMAIL.toLowerCase().trim(),
            password: process.env.SUPER_ADMIN_PASSWORD,
            role: "super_admin",
            organisationId: null,
        });

        console.log("\n====================================");
        console.log(" Super Admin created successfully");
        console.log("====================================");
        console.log(`ID    : ${admin._id}`);
        console.log(`Name  : ${admin.name}`);
        console.log(`Email : ${admin.email}`);
        console.log(`Role  : ${admin.role}`);
        console.log("====================================");
        console.log("\nPlease log in and change the password immediately.");

        process.exit(0);
    } catch (err) {
        console.error("\nFailed to create Super Admin");
        console.error(err.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
};

createSuperAdmin();
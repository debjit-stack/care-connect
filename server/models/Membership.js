/**
 * server/models/Membership.js
 * ──────────────────────────────
 * PHASE M2 — Membership model.
 *
 * Represents ONE relationship between an identity (User) and an
 * organisation: what role that person holds there, and whether that
 * relationship is currently active.
 *
 * This is deliberately separate from User (identity: email, password, MFA
 * enrollment — global, org-independent) and separate from Doctor
 * (role-specific clinical data — scoped to one Membership, not to a User
 * directly, from Phase M4 onward).
 *
 * IMPORTANT — this phase (M2) is additive only:
 *   - No existing code path reads from this collection yet.
 *   - No existing code path writes to this collection yet, except the
 *     one-time backfill migration (007-membership-model.js).
 *   - `protect`, `loginUser`, and every controller in the app continue to
 *     use `User.role` / `User.organisationId` exactly as before, until
 *     Phase M3 (Authentication migration) switches them over.
 *
 * One person, one role, per organisation — per the approved architecture
 * decision. If multi-role-per-person-per-org is ever needed, it should be
 * solved by expanding what a single Membership's role/permissions can
 * express, NOT by allowing multiple Membership documents for the same
 * (userId, organisationId) pair. The unique index below enforces that.
 */

import mongoose from 'mongoose';

const membershipSchema = new mongoose.Schema(
    {
        userId: {
            type:     mongoose.Schema.Types.ObjectId,
            ref:      'User',
            required: true,
        },
        organisationId: {
            type:     mongoose.Schema.Types.ObjectId,
            ref:      'Organisation',
            required: true,
        },
        role: {
            type:     String,
            required: true,
            enum:     ['admin', 'doctor', 'receptionist', 'patient'],
            // NOTE: super_admin is intentionally NOT a Membership role.
            // super_admin has no organisationId and continues to
            // authenticate via the separate platform-login flow — see
            // AUTH_FLOW.md. A Membership always belongs to exactly one
            // organisation; super_admin structurally does not.
        },
        status: {
            type:    String,
            required: true,
            enum:    ['active', 'suspended', 'removed'],
            default: 'active',
        },

        // M3 will move MFA *policy evaluation* to read this field instead
        // of User.forceMfa. MFA *enrollment* itself (mfaSecret, mfaEnabled,
        // recoveryCodes) stays on User — it is a property of the identity's
        // credential, not of any one organisation relationship.
        forceMfa: {
            type:    Boolean,
            default: false,
        },

        joinedAt: {
            type:    Date,
            default: Date.now,
        },
        // Set when status transitions to 'removed'. This is the
        // Membership-level soft delete — it means "this person no longer
        // has a relationship with this organisation." It must NEVER cause
        // User.deletedAt to be touched; the identity persists regardless
        // of how many of its memberships are removed.
        removedAt: {
            type:    Date,
            default: null,
        },

        // Who granted this membership, where known (staff-created accounts
        // have this; self-registered patients do not).
        invitedBy: {
            type:    mongoose.Schema.Types.ObjectId,
            ref:     'User',
            default: null,
        },
    },
    { timestamps: true }
);

// One person, one role, per organisation.
membershipSchema.index({ userId: 1, organisationId: 1 }, { unique: true });

// Org-scoped staff/doctor/patient listings — mirrors how Doctor/User are
// already queried per-org today.
membershipSchema.index({ organisationId: 1, role: 1, status: 1 });

// "Which organisations does this person currently have active access to" —
// the core query of the new Step-B login flow (Phase M3).
membershipSchema.index({ userId: 1, status: 1 });

const Membership = mongoose.model('Membership', membershipSchema);
export default Membership;

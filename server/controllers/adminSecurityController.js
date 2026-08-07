/**
 * server/controllers/adminSecurityController.js
 * P3D: Added sendMail calls on resetUserMfa and updateUserSecurity (forceMfa=true).
 *
 * PHASE M-follow-up FIX: getUserSecurity, updateUserSecurity, and
 * resetUserMfa previously resolved their target user via
 * User.findOne({ _id, deletedAt: null }) with NO explicit organisationId —
 * relying entirely on tenantPlugin's implicit ambient-org filter against
 * the legacy, single-value User.organisationId field. Same root cause as
 * every other bug fixed in this investigation: for a multi-org identity
 * whose stale field points elsewhere, these endpoints would 404 a
 * perfectly valid target user at a second organisation.
 *
 * Now resolved via the SAME findOrgScopedUser helper adminController.js
 * uses (imported from there rather than duplicated) — an ACTIVE Membership
 * at req.orgId is the explicit tenant-isolation check, replacing the
 * accidental protection the old implicit filter used to provide.
 *
 * Also: forceMfa policy moves from User.forceMfa (global — silently forced
 * MFA on EVERY organisation an identity belongs to) to Membership.forceMfa
 * (correctly scoped to the organisation the admin is actually managing).
 * MFA ENROLLMENT itself (mfaSecret, mfaEnabled, recoveryCodes) stays on
 * User — that remains identity-level, shared across every org relationship,
 * which is correct and unchanged.
 */

import Organisation from '../models/Organisation.js';
import User         from '../models/User.js';
import audit        from '../utils/audit.js';
import { sendMail, templates } from '../utils/mailer.js';
import { findOrgScopedUser }   from './adminController.js';

// ─── GET /api/admin/security ──────────────────────────────────────────────────
export const getSecuritySettings = async (req, res) => {
    try {
        const organisation = await Organisation.findById(req.orgId);
        if (!organisation || organisation.deletedAt) {
            return res.status(404).json({ message: 'Organisation not found.' });
        }
        return res.json({ mfaRequired: organisation.features?.mfaRequired ?? false });
    } catch (err) {
        console.error('[Admin Security] getSecuritySettings:', err);
        return res.status(500).json({ message: 'Failed to fetch security settings.' });
    }
};

// ─── PUT /api/admin/security ──────────────────────────────────────────────────
export const updateSecuritySettings = async (req, res) => {
    try {
        const { mfaRequired } = req.body;
        if (typeof mfaRequired !== 'boolean') {
            return res.status(400).json({ message: 'mfaRequired must be a boolean.' });
        }

        const organisation = await Organisation.findById(req.orgId);
        if (!organisation || organisation.deletedAt) {
            return res.status(404).json({ message: 'Organisation not found.' });
        }

        organisation.features.mfaRequired = mfaRequired;
        await organisation.save();

        audit(req, 'SECURITY_POLICY_UPDATED', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Organisation',
            resourceId:   organisation._id,
            meta:         { mfaRequired },
        });

        return res.json({
            message:  'Security settings updated successfully.',
            settings: { mfaRequired: organisation.features.mfaRequired },
        });
    } catch (err) {
        console.error('[Admin Security] updateSecuritySettings:', err);
        return res.status(500).json({ message: 'Failed to update security settings.' });
    }
};

// ─── GET /api/admin/users/:id/security ───────────────────────────────────────
export const getUserSecurity = async (req, res) => {
    try {
        const resolved = await findOrgScopedUser(req.params.id, req.orgId);
        if (!resolved) return res.status(404).json({ message: 'User not found.' });

        const { user, membership } = resolved;

        audit(req, 'SECURITY_USER_VIEWED', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
        });

        return res.json({
            mfaEnabled:     user.mfaEnabled,
            // forceMfa now read from THIS organisation's Membership, not
            // the global User field — see file header.
            forceMfa:       membership.forceMfa ?? false,
            lastMfaResetAt: user.lastMfaResetAt ?? null,
        });
    } catch (err) {
        console.error('[Admin Security] getUserSecurity:', err);
        return res.status(500).json({ message: 'Failed to fetch user security settings.' });
    }
};

// ─── PUT /api/admin/users/:id/security ───────────────────────────────────────
// P3D: Sends adminForcedMfa email when forceMfa is set to true.
export const updateUserSecurity = async (req, res) => {
    try {
        const allowedFields   = ['forceMfa'];
        const receivedFields  = Object.keys(req.body);
        const invalidFields   = receivedFields.filter((f) => !allowedFields.includes(f));

        if (invalidFields.length) {
            return res.status(400).json({ message: `Invalid field(s): ${invalidFields.join(', ')}` });
        }

        const { forceMfa } = req.body;
        if (typeof forceMfa !== 'boolean') {
            return res.status(400).json({ message: 'forceMfa must be a boolean.' });
        }

        const resolved = await findOrgScopedUser(req.params.id, req.orgId);
        if (!resolved) return res.status(404).json({ message: 'User not found.' });

        const { user, membership } = resolved;

        const wasAlreadyForced = membership.forceMfa ?? false;
        membership.forceMfa = forceMfa;
        await membership.save();

        audit(req, 'SECURITY_FORCE_MFA_UPDATED', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Membership',
            resourceId:   membership._id,
            meta:         { forceMfa, userId: user._id.toString(), orgId: req.orgId },
        });

        // P3D: Notify user when admin forces MFA on their account (not when removing)
        if (forceMfa && !wasAlreadyForced) {
            const adminUser = req.user;
            const org       = req.org ?? null;
            sendMail({
                to:  user.email,
                org,
                ...templates.adminForcedMfa({
                    userName:  user.name,
                    adminName: adminUser.name,
                    org,
                }),
            });
        }

        return res.json({
            message:  'User security updated successfully.',
            security: {
                mfaEnabled:     user.mfaEnabled,
                forceMfa:       membership.forceMfa,
                lastMfaResetAt: user.lastMfaResetAt,
            },
        });
    } catch (err) {
        console.error('[Admin Security] updateUserSecurity:', err);
        return res.status(500).json({ message: 'Failed to update user security.' });
    }
};

// ─── POST /api/admin/users/:id/reset-mfa ─────────────────────────────────────
// P3D: Sends mfaResetByAdmin email to the affected user.
//
// NOTE: MFA enrollment (mfaSecret/mfaEnabled/recoveryCodes) is
// identity-level, not organisation-level — resetting it here affects the
// person's login EVERYWHERE they have an active Membership, not just at
// req.orgId. This is a deliberate, existing product decision (see the
// architecture discussion on resetPassword having the same property), not
// something this fix changes — flagged here only so it's explicit rather
// than assumed.
export const resetUserMfa = async (req, res) => {
    try {
        const resolved = await findOrgScopedUser(req.params.id, req.orgId);
        if (!resolved) return res.status(404).json({ message: 'User not found.' });

        const user = await User
            .findById(resolved.user._id)
            .select('+mfaSecret +recoveryCodes')
            .skipTenantFilter();

        if (!user) return res.status(404).json({ message: 'User not found.' });

        user.mfaEnabled    = false;
        user.mfaSecret     = null;
        user.recoveryCodes = [];
        user.lastMfaResetAt = new Date();
        await user.save();

        audit(req, 'SECURITY_MFA_RESET', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { orgId: req.orgId },
        });

        // P3D: Security email to affected user (fire-and-forget)
        const org = req.org ?? null;
        sendMail({
            to:  user.email,
            org,
            ...templates.mfaResetByAdmin({
                userName:  user.name,
                adminName: req.user.name,
                org,
            }),
        });

        return res.json({ message: 'User MFA has been reset successfully.' });
    } catch (err) {
        console.error('[Admin Security] resetUserMfa:', err);
        return res.status(500).json({ message: 'Failed to reset user MFA.' });
    }
};

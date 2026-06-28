import Organisation from '../models/Organisation.js';
import User from '../models/User.js';
import audit from '../utils/audit.js';

// ────────────────────────────────────────────────────────────────
// GET /api/admin/security
// Returns organisation-wide security configuration
// ────────────────────────────────────────────────────────────────
export const getSecuritySettings = async (req, res) => {
    try {
        const organisation = await Organisation.findById(req.orgId);

        if (!organisation || organisation.deletedAt) {
            return res.status(404).json({
                message: 'Organisation not found.',
            });
        }

        return res.json({
            mfaRequired: organisation.features?.mfaRequired ?? false,
        });
    } catch (err) {
        console.error('[Admin Security] getSecuritySettings:', err);

        return res.status(500).json({
            message: 'Failed to fetch security settings.',
        });
    }
};

// ────────────────────────────────────────────────────────────────
// PUT /api/admin/security
// Updates organisation-wide security configuration
// ────────────────────────────────────────────────────────────────
export const updateSecuritySettings = async (req, res) => {
    try {
        const { mfaRequired } = req.body;

        if (typeof mfaRequired !== 'boolean') {
            return res.status(400).json({
                message: 'mfaRequired must be a boolean.',
            });
        }

        const organisation = await Organisation.findById(req.orgId);

        if (!organisation || organisation.deletedAt) {
            return res.status(404).json({
                message: 'Organisation not found.',
            });
        }

        organisation.features.mfaRequired = mfaRequired;

        await organisation.save();

        audit(req, 'SECURITY_POLICY_UPDATED', {
            actorId: req.user._id,
            actorRole: req.user.role,
            resourceType: 'Organisation',
            resourceId: organisation._id,
            meta: {
                mfaRequired,
            },
        });

        return res.json({
            message: 'Security settings updated successfully.',
            settings: {
                mfaRequired: organisation.features.mfaRequired,
            },
        });

    } catch (err) {
        console.error('[Admin Security] updateSecuritySettings:', err);

        return res.status(500).json({
            message: 'Failed to update security settings.',
        });
    }
};

// ────────────────────────────────────────────────────────────────
// GET /api/admin/users/:id/security
// Returns security state of a user
// ────────────────────────────────────────────────────────────────
export const getUserSecurity = async (req, res) => {
    try {
        const user = await User.findOne({
            _id: req.params.id,
            deletedAt: null,
        });

        if (!user) {
            return res.status(404).json({
                message: 'User not found.',
            });
        }

        audit(req, 'SECURITY_USER_VIEWED', {
            actorId: req.user._id,
            actorRole: req.user.role,
            resourceType: 'User',
            resourceId: user._id,
        });

        return res.json({
            mfaEnabled: user.mfaEnabled,
            forceMfa: user.forceMfa ?? false,
            lastMfaResetAt: user.lastMfaResetAt ?? null,
        });

    } catch (err) {
        console.error('[Admin Security] getUserSecurity:', err);

        return res.status(500).json({
            message: 'Failed to fetch user security settings.',
        });
    }
};

// ────────────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/security
// Update per-user security settings
// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/security
// Update per-user security settings
// ────────────────────────────────────────────────────────────────
export const updateUserSecurity = async (req, res) => {
    try {

        // Only allow forceMfa to be updated
        const allowedFields = ['forceMfa'];

        const receivedFields = Object.keys(req.body);

        const invalidFields = receivedFields.filter(
            field => !allowedFields.includes(field)
        );

        if (invalidFields.length) {
            return res.status(400).json({
                message: `Invalid field(s): ${invalidFields.join(', ')}`,
            });
        }

        const { forceMfa } = req.body;

        if (typeof forceMfa !== 'boolean') {
            return res.status(400).json({
                message: 'forceMfa must be a boolean.',
            });
        }

        const user = await User.findOne({
            _id: req.params.id,
            deletedAt: null,
        });

        if (!user) {
            return res.status(404).json({
                message: 'User not found.',
            });
        }

        user.forceMfa = forceMfa;

        await user.save();

        audit(req, 'SECURITY_FORCE_MFA_UPDATED', {
            actorId: req.user._id,
            actorRole: req.user.role,
            resourceType: 'User',
            resourceId: user._id,
            meta: {
                forceMfa,
            },
        });

        return res.json({
            message: 'User security updated successfully.',
            security: {
                mfaEnabled: user.mfaEnabled,
                forceMfa: user.forceMfa,
                lastMfaResetAt: user.lastMfaResetAt,
            },
        });

    } catch (err) {
        console.error('[Admin Security] updateUserSecurity:', err);

        return res.status(500).json({
            message: 'Failed to update user security.',
        });
    }
};

// ────────────────────────────────────────────────────────────────
// POST /api/admin/users/:id/reset-mfa
// Forces user to enroll again
// ────────────────────────────────────────────────────────────────
export const resetUserMfa = async (req, res) => {
    try {
        const user = await User.findOne({
            _id: req.params.id,
            deletedAt: null,
        }).select('+mfaSecret');

        if (!user) {
            return res.status(404).json({
                message: 'User not found.',
            });
        }

        user.mfaEnabled = false;
        user.mfaSecret = null;
        user.lastMfaResetAt = new Date();

        await user.save();

        audit(req, 'SECURITY_MFA_RESET', {
            actorId: req.user._id,
            actorRole: req.user.role,
            resourceType: 'User',
            resourceId: user._id,
        });

        return res.json({
            message: 'User MFA has been reset successfully.',
        });

    } catch (err) {
        console.error('[Admin Security] resetUserMfa:', err);

        return res.status(500).json({
            message: 'Failed to reset user MFA.',
        });
    }
};
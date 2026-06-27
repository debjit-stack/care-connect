import Organisation from '../models/Organisation.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';

// ── Paths that bypass tenant resolution completely ────────────────────────────
const PUBLIC_PATHS = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/auth/logout',
    '/api/auth/logout-all',
    '/api/health',
    // WS1 MFA: /validate uses mfaPending JWT in request body, not access token
    // It resolves its own user context from the pending token
    '/api/auth/mfa/validate',
    // Public browsing — no org context needed for anonymous visitors
    '/api/doctors',
    '/api/packages',
];

// ── Resolve org slug/id from request ─────────────────────────────────────────
const resolveSlug = (req) => {
    const headerSlug = req.headers['x-organisation-slug'];
    if (headerSlug) return { type: 'slug', value: headerSlug.toLowerCase().trim() };

    const headerId = req.headers['x-organisation-id'];
    if (headerId) return { type: 'id', value: headerId.trim() };

    const host  = req.headers.host || '';
    const parts = host.split('.');
    if (
        parts.length >= 3 &&
        !['www', 'api', 'careconnect', 'localhost'].includes(parts[0])
    ) {
        return { type: 'slug', value: parts[0] };
    }

    return null;
};

// ── Main middleware ────────────────────────────────────────────────────────────
export const resolveTenant = async (req, res, next) => {
    const isPublic = PUBLIC_PATHS.some(
        (p) => req.originalUrl === p ||
               req.originalUrl.startsWith(p + '/') ||
               req.originalUrl.startsWith(p + '?')
    );
    if (isPublic) return next();

    const resolved = resolveSlug(req);

    if (!resolved) {
        try {
            const count = await Organisation.countDocuments({ deletedAt: null, isActive: true });

            if (count === 1) {
                const org = await Organisation.findOne({ deletedAt: null, isActive: true });
                if (org && org.isAccessible) {
                    req.org   = org;
                    req.orgId = org._id;
                    return runWithTenant(org._id, () => next());
                }
            }

            if (count === 0) {
                return next();
            }

            return res.status(400).json({
                message: 'Organisation not specified. Include X-Organisation-Slug header or use your subdomain.',
            });
        } catch (err) {
            console.error('[Tenant] auto-resolve error:', err.message);
            return res.status(500).json({ message: 'Failed to resolve organisation' });
        }
    }

    try {
        const org = resolved.type === 'slug'
            ? await Organisation.findOne({ slug: resolved.value, deletedAt: null })
            : await Organisation.findOne({ _id: resolved.value, deletedAt: null });

        if (!org) {
            return res.status(404).json({ message: 'Organisation not found' });
        }

        if (!org.isAccessible) {
            return res.status(403).json({
                message: 'Your organisation account is suspended or your trial has ended. Please contact support.',
            });
        }

        req.org   = org;
        req.orgId = org._id;

        runWithTenant(org._id, () => next());
    } catch (err) {
        console.error('[Tenant] resolution error:', err.message);
        res.status(500).json({ message: 'Failed to resolve organisation' });
    }
};

// ── Feature flag guard ────────────────────────────────────────────────────────
export const requireFeature = (featureKey) => (req, res, next) => {
    const org = req.org;
    if (!org) return next();
    if (!org.features?.[featureKey]) {
        return res.status(403).json({
            message: `This feature (${featureKey}) is not enabled for your organisation.`,
        });
    }
    next();
};

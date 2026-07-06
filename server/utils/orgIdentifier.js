/**
 * server/utils/orgIdentifier.js
 * ────────────────────────────────
 * PHASE 2 (H1 fix support): pure, synchronous extraction of the raw
 * organisation identifier a client is claiming for this request — from the
 * X-Organisation-Slug header, X-Organisation-Id header, or subdomain.
 *
 * Deliberately does NOT touch the database. It answers "what did the client
 * claim?", not "is that a real, accessible organisation?" — that validation
 * still belongs to tenantMiddleware.resolveTenant (for tenant-scoped routes)
 * and authController.resolveOrgFromRequest (for the pre-auth routes).
 *
 * Scope note: this utility is currently used by rateLimiter.js and
 * tenantMiddleware.js's resolveSlug only. authController.js's
 * resolveOrgFromRequest still has its own independent (currently identical)
 * extraction logic — consolidating that in here as well is deferred to a
 * later cleanup pass so this change stays scoped to the H1/H2 fix.
 *
 * Returns: { type: 'slug' | 'id', value: string } | null
 */

const EXCLUDED_SUBDOMAIN_PREFIXES = ['www', 'api', 'careconnect', 'localhost'];

export const extractOrgIdentifier = (req) => {
    const headerSlug = req.headers['x-organisation-slug'];
    if (headerSlug) return { type: 'slug', value: headerSlug.toLowerCase().trim() };

    const headerId = req.headers['x-organisation-id'];
    if (headerId) return { type: 'id', value: headerId.trim() };

    const host  = req.headers.host || '';
    const parts = host.split('.');
    if (parts.length >= 3 && !EXCLUDED_SUBDOMAIN_PREFIXES.includes(parts[0])) {
        return { type: 'slug', value: parts[0] };
    }

    return null;
};

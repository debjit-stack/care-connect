import Organisation from '../models/Organisation.js';
import env from '../config/env.js';
import { extractOrgIdentifier } from './orgIdentifier.js';

/**
 * server/utils/resolveOrg.js
 * ────────────────────────────
 * PHASE5-L1 FIX: single source of truth for "given this request, which
 * Organisation (if any) applies?" — consolidating logic that was previously
 * duplicated across three places:
 *   - tenantMiddleware.resolveTenant's org lookup + single-org fallback
 *   - authController.resolveOrgFromRequest (identical duplicate)
 *   - authController.loginUser's own SECOND, independent ambiguity/count
 *     check (found during the Phase 2 follow-up fix — it duplicated the
 *     fallback-gating decision rather than calling shared logic for it)
 *
 * That duplication is exactly what the audit's L1 finding warned would
 * cause future drift — and it already had, once (loginUser's separate
 * check falling out of sync with resolveOrgFromRequest's gating during
 * Phase 2). This is the fix for the root cause, not just that one symptom.
 *
 * Returns exactly one of four discriminated results:
 *
 *   { status: 'resolved',  org }
 *     An organisation was found — either from an explicit client-supplied
 *     identifier (header/subdomain), or auto-picked because exactly one
 *     organisation exists AND ALLOW_SINGLE_ORG_AUTO_RESOLVE is enabled.
 *
 *   { status: 'not_found' }
 *     An explicit identifier WAS supplied, but no matching, non-deleted
 *     organisation exists for it. Distinct from 'ambiguous' — this is a
 *     client error (wrong slug/id), not "didn't tell us which org."
 *
 *   { status: 'ambiguous' }
 *     No identifier was supplied, and either: 2+ organisations exist, or
 *     exactly 1 exists but auto-resolve is disabled/unusable (the lone org
 *     isn't currently accessible). Callers that need an explicit org
 *     should treat this as "client must specify" (typically a 400).
 *
 *   { status: 'no_orgs' }
 *     No identifier was supplied and zero organisations exist system-wide
 *     (fresh install, nothing to scope against yet). Callers typically
 *     proceed with no tenant context at all in this case.
 *
 * Deliberately does NOT touch req.org/req.orgId, does not call next(), and
 * never sends an HTTP response — those stay the caller's responsibility,
 * since identical resolution outcomes need different handling at different
 * call sites. In particular: authController's forgotPassword/
 * verifyForgotPasswordOtp must never let org-resolution failure produce any
 * response distinguishable from "user not found" (to avoid leaking account
 * or org existence via response shape/timing) — they need the raw
 * discriminated result to decide that for themselves, not a thrown error or
 * an auto-400.
 */
export const resolveOrganisation = async (req) => {
    const identifier = extractOrgIdentifier(req);

    if (identifier) {
        const org = identifier.type === 'slug'
            ? await Organisation.findOne({ slug: identifier.value, deletedAt: null })
            : await Organisation.findOne({ _id: identifier.value, deletedAt: null });

        return org ? { status: 'resolved', org } : { status: 'not_found' };
    }

    const count = await Organisation.countDocuments({ deletedAt: null, isActive: true });

    if (count === 0) {
        return { status: 'no_orgs' };
    }

    if (env.ALLOW_SINGLE_ORG_AUTO_RESOLVE && count === 1) {
        const org = await Organisation.findOne({ deletedAt: null, isActive: true });
        if (org && org.isAccessible) {
            return { status: 'resolved', org };
        }
        // The lone org exists but isn't actually accessible (suspended /
        // trial expired) — there's no usable default to fall back to, so
        // this is functionally the same as "ambiguous," not "resolved."
        return { status: 'ambiguous' };
    }

    return { status: 'ambiguous' };
};

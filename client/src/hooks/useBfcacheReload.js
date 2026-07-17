import { useEffect } from 'react';

/**
 * useBfcacheReload
 * ─────────────────
 * Forces a hard reload if this page is restored from the browser's
 * back/forward cache (bfcache) rather than freshly mounted.
 *
 * Why this matters for auth pages specifically: bfcache restoration brings
 * back the exact frozen DOM + JS state from before navigation — including
 * stale AuthContext state, a completed-but-now-unmounted MFA verify screen,
 * or (on MFASetupPage) a setup screen tied to an mfaPending token that may
 * since have been consumed or expired. None of React's normal lifecycle
 * (mount effects, route guards, isAuthenticated checks) re-runs on a
 * bfcache restore, since nothing actually unmounted/remounted — the page
 * was merely paused and resumed exactly as it was.
 *
 * A full reload forces every guard to re-evaluate from scratch on next
 * paint, which is the standard mitigation for this class of issue (the
 * same pattern used by most banking/auth UIs). `event.persisted` is the
 * standard signal a `pageshow` event gives for "this came from bfcache,
 * not a fresh navigation" — a normal mount/route-change never sets it.
 */
const useBfcacheReload = () => {
    useEffect(() => {
        const handlePageShow = (event) => {
            if (event.persisted) {
                window.location.reload();
            }
        };
        window.addEventListener('pageshow', handlePageShow);
        return () => window.removeEventListener('pageshow', handlePageShow);
    }, []);
};

export default useBfcacheReload;

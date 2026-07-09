import axios from 'axios';

// ── Access token (in-memory only) ─────────────────────────────────────────────
let _accessToken = null;
let _orgSlug     = null;

export const setAccessToken   = (t)  => { _accessToken = t; };
export const getAccessToken   = ()   => _accessToken;
export const clearAccessToken = ()   => { _accessToken = null; };

export const setOrgSlug = (slug) => {
    _orgSlug = slug;
    if (slug) sessionStorage.setItem('cc_org_slug', slug);
    else sessionStorage.removeItem('cc_org_slug');
};
export const clearOrgSlug = () => { _orgSlug = null; sessionStorage.removeItem('cc_org_slug'); };

// PHASE-E FIX: replaces the earlier `platformMode` flag entirely (removed
// — setPlatformMode/getPlatformMode/clearPlatformMode no longer exist).
//
// Root cause of the bug this replaces: platformMode's only writer was a
// single page's mount effect (SuperAdminLoginPage). A silent session
// restore via the httpOnly refresh cookie (AuthContext.restoreSession)
// never mounts that page — it redirects straight to the dashboard — so the
// flag never got set on that path, and any leftover explicit org slug from
// an earlier "Manage Hospital" click in the same browser session would
// then leak into every request for the rest of that silently-restored
// session, with no reliable way to have prevented it.
//
// The fix: stop tracking a separate flag at all. currentUserRole is set by
// the SAME two code paths that reliably fire on every possible way to end
// up authenticated — completeLogin() (password/MFA login) and
// restoreSession()'s success branch (silent cookie restore) — so it can
// never drift out of sync with who is actually logged in. Same
// module-variable + sessionStorage-mirror pattern as _orgSlug, for the
// same reason (survives a page refresh).
let _currentUserRole = null;

export const setCurrentUserRole = (role) => {
    _currentUserRole = role;
    if (role) sessionStorage.setItem('cc_user_role', role);
    else sessionStorage.removeItem('cc_user_role');
};
export const getCurrentUserRole = () => _currentUserRole ?? sessionStorage.getItem('cc_user_role');
export const clearCurrentUserRole = () => { _currentUserRole = null; sessionStorage.removeItem('cc_user_role'); };

// PHASE-E FIX: getOrgSlug() is the SINGLE function responsible for
// determining the tenant header — the axios request interceptor below is
// its only caller, and no other code in the app reads sessionStorage's
// org-slug key directly. (Confirmed by audit: every setOrgSlug/
// clearOrgSlug/getOrgSlug call site in the codebase goes through this
// module; nothing bypasses it.)
//
// Precedence, in order:
//   0. PHASE-F FIX: the request is going to /auth/platform-login itself →
//      null, unconditionally, before anything else is even checked. The
//      platform-login REQUEST is sent before any response comes back, so
//      currentUserRole (step 2 below) cannot possibly reflect the
//      super_admin identity of a request that hasn't succeeded yet —
//      role-derivation is correct for every request AFTER authentication,
//      it structurally cannot be correct for the login request that
//      produces that authentication. This is a stateless, per-call check
//      against the request URL the interceptor already has — not a new
//      flag, not sent to or trusted by the backend for any decision (the
//      backend already independently guarantees this endpoint never
//      resolves tenant context — see tenantMiddleware's PUBLIC_EXACT
//      list). It only stops the client from ever sending the header here.
//   1. An explicit slug (via setOrgSlug — "Manage Hospital") always wins,
//      regardless of role. This is what lets a super_admin deliberately
//      step INTO a specific hospital's context.
//   2. currentUserRole === 'super_admin' with no explicit slug → null,
//      always. Never falls back to the env var. Because currentUserRole is
//      set by both completeLogin AND restoreSession, this is correct
//      regardless of HOW the super_admin's session came to exist — fresh
//      password login, MFA completion, or silent cookie restore all
//      converge on the same role state (for every request except the
//      platform-login request itself, which step 0 already handles).
//   3. Otherwise (ordinary hospital user, or no known role yet) → the
//      explicit slug if set, else the env fallback. Unchanged from
//      original hospital-frontend behaviour.
const PLATFORM_LOGIN_PATH = '/auth/platform-login';

export const getOrgSlug = (requestUrl) => {
    if (requestUrl?.includes(PLATFORM_LOGIN_PATH)) return null;

    const explicit = _orgSlug || sessionStorage.getItem('cc_org_slug');
    if (explicit) return explicit;

    if (getCurrentUserRole() === 'super_admin') return null;

    return import.meta.env.VITE_ORGANISATION_SLUG;
};

// ── Axios instance ────────────────────────────────────────────────────────────
const API = axios.create({
    baseURL:         import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
    withCredentials: true,
    timeout:         15000,
});

API.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    const slug = getOrgSlug(config.url);
    if (slug)  config.headers['X-Organisation-Slug'] = slug;
    return config;
}, (error) => Promise.reject(error));

let isRefreshing = false;
let refreshQueue = [];

const processQueue = (error, token = null) => {
    refreshQueue.forEach(({ resolve, reject }) => error ? reject(error) : resolve(token));
    refreshQueue = [];
};

API.interceptors.response.use(
    (response) => response,
    async (error) => {
        const orig = error.config;
        if (
            error.response?.status === 401 &&
            !orig._retry &&
            !orig.url.includes('/auth/refresh') &&
            !orig.url.includes('/auth/login') &&
            !orig.url.includes('/auth/platform-login')
        ) {
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    refreshQueue.push({ resolve, reject });
                }).then((token) => {
                    orig.headers.Authorization = `Bearer ${token}`;
                    return API(orig);
                });
            }
            orig._retry   = true;
            isRefreshing  = true;
            try {
                const { data } = await API.post('/auth/refresh');
                setAccessToken(data.accessToken);
                processQueue(null, data.accessToken);
                orig.headers.Authorization = `Bearer ${data.accessToken}`;
                return API(orig);
            } catch (refreshError) {
                processQueue(refreshError, null);
                clearAccessToken();
                clearOrgSlug();
                window.dispatchEvent(new CustomEvent('auth:session-expired'));
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }
        return Promise.reject(error);
    }
);

export default API;

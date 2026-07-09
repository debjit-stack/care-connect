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

// PHASE-D addition: Platform Mode flag. Same module-variable +
// sessionStorage-mirror pattern as _orgSlug, so it survives a page refresh
// (e.g. a super_admin refreshing while on /super-admin shouldn't suddenly
// fall back into Hospital Mode).
let _platformMode = null;

export const setPlatformMode = (on) => {
    _platformMode = on;
    if (on) sessionStorage.setItem('cc_platform_mode', 'true');
    else sessionStorage.removeItem('cc_platform_mode');
};
export const getPlatformMode = () => {
    if (_platformMode !== null) return _platformMode;
    return sessionStorage.getItem('cc_platform_mode') === 'true';
};
export const clearPlatformMode = () => { _platformMode = false; sessionStorage.removeItem('cc_platform_mode'); };

// PHASE-D FIX: root cause of the Super Admin login/dashboard breakage.
// Previously: `_orgSlug || sessionStorage.getItem('cc_org_slug') ||
// import.meta.env.VITE_ORGANISATION_SLUG` — meaning ANY session, including
// a super_admin's, silently fell back to the hospital's env-configured
// slug the moment no explicit slug was set. That's exactly backwards for
// Platform Mode: a super_admin must start with NO organisation header at
// all (see authController.loginUser's super_admin bypass, which depends on
// this), but previously could never actually reach that state as long as
// VITE_ORGANISATION_SLUG was configured for hospital deployments — leaving
// only "break hospital logins by unsetting the env var" as the workaround,
// which is what caused the original bug report.
//
// Precedence, in order:
//   1. An explicit slug (via setOrgSlug — e.g. "Manage Hospital") always
//      wins, regardless of mode. This is what lets a super_admin
//      deliberately step INTO a specific hospital's context.
//   2. Platform Mode with no explicit slug → null, always. Never falls
//      back to the env var. This is what makes the org-header-free login
//      and dashboard calls actually reach the backend's super_admin
//      bypass path instead of accidentally scoping to whatever hospital
//      the .env happens to be configured for.
//   3. Otherwise (ordinary Hospital Mode) → unchanged from before: the
//      explicit slug if set, else the env fallback. Hospital deployments
//      using VITE_ORGANISATION_SLUG continue working exactly as they did
//      before this fix — this is what Task 1 (restore hospital frontend
//      behaviour) required.
export const getOrgSlug = () => {
    const explicit = _orgSlug || sessionStorage.getItem('cc_org_slug');
    if (explicit) return explicit;

    if (getPlatformMode()) return null;

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
    const slug = getOrgSlug();
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
            !orig.url.includes('/auth/login')
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

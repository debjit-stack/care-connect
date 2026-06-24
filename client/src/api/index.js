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
export const getOrgSlug   = () => _orgSlug || sessionStorage.getItem('cc_org_slug')|| import.meta.env.VITE_ORGANISATION_SLUG;
export const clearOrgSlug = () => { _orgSlug = null; sessionStorage.removeItem('cc_org_slug'); };

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

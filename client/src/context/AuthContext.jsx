import React, {
    createContext,
    useState,
    useEffect,
    useContext,
    useCallback,
    useRef,
} from "react";

import {
    login as loginApi,
    platformLogin as platformLoginApi,
    logout as logoutApi,
    logoutAll as logoutAllApi,
    refreshToken,
    getMe,
} from "../api/auth.js";

import {
    setAccessToken,
    clearAccessToken,
    setOrgSlug,
    clearOrgSlug,
    setCurrentUserRole,
    clearCurrentUserRole,
} from "../api/index.js";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [org, setOrg] = useState(null);
    const [loading, setLoading] = useState(true);

    const refreshAttempted = useRef(false);

    // Restore session
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);

        if (
            window.location.pathname === "/mfa-setup" &&
            params.has("mfaPending")
        ) {
            setLoading(false);
            return;
        }

        if (refreshAttempted.current) return;
        refreshAttempted.current = true;

        const restoreSession = async () => {
            try {
                const { data: tokenData } = await refreshToken();

                setAccessToken(tokenData.accessToken);

                const { data: meData } = await getMe();

                setUser(meData.user);
                setOrg(meData.user.organisation ?? null);

                // PHASE-E FIX: this is the critical fix for the root cause
                // identified in this phase's audit. A silently-restored
                // session (via httpOnly refresh cookie, e.g. reopening the
                // app without having logged out) NEVER mounts
                // SuperAdminLoginPage or LoginPage — it goes straight from
                // this effect to whatever dashboard route the user's role
                // sends them to. Setting currentUserRole HERE, on every
                // restore, regardless of role, means getOrgSlug()'s
                // super_admin check (api/index.js) is correct on this path
                // too, not just on a fresh password login. This was
                // previously missing entirely for the old platformMode
                // flag, which is the actual bug this phase fixes.
                setCurrentUserRole(meData.user.role);

                if (meData.user.organisation?.slug) {
                    setOrgSlug(meData.user.organisation.slug);
                }
                // Note: super_admin's meData.user.organisation is always
                // null, so the branch above is simply skipped for them —
                // correct, since Manage Hospital's explicit setOrgSlug call
                // (if any, from before this refresh) is left untouched by
                // this restore, and getOrgSlug()'s role-based branch
                // handles the "no explicit slug" case correctly either way.
            } catch {
                clearAccessToken();
                clearOrgSlug();
                clearCurrentUserRole();
                setUser(null);
                setOrg(null);
            } finally {
                setLoading(false);
            }
        };

        restoreSession();
    }, []);

    // Session expired listener
    // PHASE-E FIX: previously did not clear platform-related state at all
    // (the old platformMode flag). Now clears currentUserRole too — closing
    // the second, smaller gap found in this phase's audit: without this, a
    // super_admin's session silently expiring would leave stale role state
    // behind, and a DIFFERENT hospital user logging in on the same tab
    // afterward could inherit "never fall back to the env slug" behaviour
    // for a reason that would be very confusing to debug.
    useEffect(() => {
        const handler = () => {
            clearAccessToken();
            clearOrgSlug();
            clearCurrentUserRole();
            setUser(null);
            setOrg(null);
        };

        window.addEventListener("auth:session-expired", handler);

        return () =>
            window.removeEventListener("auth:session-expired", handler);
    }, []);

    // ============================================================
    // COMPLETE LOGIN (MUST COME BEFORE login()/platformLogin())
    // ============================================================

    const completeLogin = useCallback((data) => {
        setAccessToken(data.accessToken);

        setUser(data.user);

        setOrg(data.user.organisation ?? null);

        // PHASE-E FIX: same fix as restoreSession above, for the
        // fresh-login path (password login and MFA-completion both funnel
        // through this function).
        setCurrentUserRole(data.user.role);

        if (data.user.organisation?.slug) {
            setOrgSlug(data.user.organisation.slug);
        }
    }, []);

    // ============================================================
    // LOGIN (hospital users — POST /api/auth/login)
    // ============================================================

    const login = useCallback(
        async (email, password) => {
            const { data } = await loginApi({
                email,
                password,
            });

            if (data.mfaRequired) {
                const mfaError = new Error("MFA required");

                mfaError.response = {
                    status: 200,
                    data,
                };

                throw mfaError;
            }

            completeLogin(data);

            return data.user;
        },
        [completeLogin]
    );

    // ============================================================
    // PLATFORM LOGIN (super_admin only — POST /api/auth/platform-login)
    // ============================================================
    // PHASE-E addition. Deliberately a SEPARATE function calling a
    // SEPARATE API endpoint, not login() with an extra parameter — the
    // distinction between hospital and platform authentication is made by
    // ROUTE, not by a client-supplied flag (see authController.js). Shares
    // completeLogin() for the actual state-setting, since that part is
    // identical either way.
    const platformLogin = useCallback(
        async (email, password) => {
            const { data } = await platformLoginApi({
                email,
                password,
            });

            if (data.mfaRequired) {
                const mfaError = new Error("MFA required");

                mfaError.response = {
                    status: 200,
                    data,
                };

                throw mfaError;
            }

            completeLogin(data);

            return data.user;
        },
        [completeLogin]
    );

    // ============================================================
    // LOGOUT
    // ============================================================

    const logout = useCallback(async () => {
        try {
            await logoutApi();
        } finally {
            clearAccessToken();
            clearOrgSlug();
            clearCurrentUserRole();

            setUser(null);
            setOrg(null);
        }
    }, []);

    // ============================================================
    // LOGOUT ALL
    // ============================================================

    const logoutAll = useCallback(async () => {
        try {
            await logoutAllApi();
        } finally {
            clearAccessToken();
            clearOrgSlug();
            clearCurrentUserRole();

            setUser(null);
            setOrg(null);
        }
    }, []);

    // ============================================================
    // UPDATE USER
    // ============================================================

    const updateUser = useCallback((updates) => {
        setUser((prev) =>
            prev
                ? {
                      ...prev,
                      ...updates,
                  }
                : prev
        );
    }, []);

    return (
        <AuthContext.Provider
            value={{
                user,
                org,
                loading,

                isAuthenticated: !!user,

                login,
                platformLogin,
                completeLogin,

                logout,
                logoutAll,

                updateUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);

    if (!ctx) {
        throw new Error("useAuth must be used inside <AuthProvider>");
    }

    return ctx;
};

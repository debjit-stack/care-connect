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
    clearPlatformMode,
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

                if (meData.user.organisation?.slug) {
                    setOrgSlug(meData.user.organisation.slug);
                }
                // PHASE-D note: super_admin's meData.user.organisation is
                // always null, so this branch is simply skipped for them —
                // no explicit slug gets set on session restore, which is
                // correct: getOrgSlug()'s Platform Mode branch (see
                // api/index.js) handles the rest, as long as Platform Mode
                // itself was already set before this restore ran (it was —
                // see SuperAdminLoginPage.jsx, which sets it before calling
                // login(), and it persists across refresh via
                // sessionStorage same as the org slug does).
            } catch {
                clearAccessToken();
                clearOrgSlug();
                setUser(null);
                setOrg(null);
            } finally {
                setLoading(false);
            }
        };

        restoreSession();
    }, []);

    // Session expired listener
    useEffect(() => {
        const handler = () => {
            clearAccessToken();
            clearOrgSlug();
            setUser(null);
            setOrg(null);
        };

        window.addEventListener("auth:session-expired", handler);

        return () =>
            window.removeEventListener("auth:session-expired", handler);
    }, []);

    // ============================================================
    // COMPLETE LOGIN (MUST COME BEFORE login())
    // ============================================================

    const completeLogin = useCallback((data) => {
        setAccessToken(data.accessToken);

        setUser(data.user);

        setOrg(data.user.organisation ?? null);

        if (data.user.organisation?.slug) {
            setOrgSlug(data.user.organisation.slug);
        }
    }, []);

    // ============================================================
    // LOGIN
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
    // LOGOUT
    // ============================================================

    // PHASE-D FIX: logout now also clears Platform Mode. Without this, a
    // super_admin logging out and a hospital user logging into the SAME
    // browser tab afterward would inherit Platform Mode's "never fall back
    // to VITE_ORGANISATION_SLUG" behaviour — breaking that hospital user's
    // login for a reason that would be very confusing to debug (the same
    // class of bug this whole phase exists to fix, just triggered from the
    // opposite direction).
    const logout = useCallback(async () => {
        try {
            await logoutApi();
        } finally {
            clearAccessToken();
            clearOrgSlug();
            clearPlatformMode();

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
            clearPlatformMode();

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

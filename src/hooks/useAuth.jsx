import { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { queryClientInstance } from "@/lib/query-client";
import { ADMIN_PERMISSIONS } from "@/lib/permissions";

// Mirrors permissions.IsWriteKey on the server, so the read-only banner agrees
// with the catalogue rather than carrying its own notion of what "write" means.
const WRITE_SUFFIX = /\.(create|update|delete|manage|deploy|run)$/;

const AuthContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || "";
const AUTH_TOKEN_KEY = "nineteen_token";
const AUTH_REFRESH_KEY = "nineteen_refresh_token";
const AUTH_USER_KEY = "nineteen_user";
const AUTH_PERMS_KEY = "nineteen_permissions";

function storeSession(data) {
  if (data.token) localStorage.setItem(AUTH_TOKEN_KEY, data.token);
  if (data.refresh_token) localStorage.setItem(AUTH_REFRESH_KEY, data.refresh_token);
  if (data.user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
}

function clearSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_PERMS_KEY);
  localStorage.removeItem("nineteen_superuser");
}

function getStoredToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getStoredPermissions() {
  try {
    const raw = localStorage.getItem(AUTH_PERMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  const [token, setToken] = useState(getStoredToken);
  const [permissions, setPermissions] = useState(getStoredPermissions);
  const [isSuperuser, setIsSuperuser] = useState(
    () => localStorage.getItem("nineteen_superuser") === "true"
  );
  const [loading, setLoading] = useState(true);

  const isAuthenticated = !!token && !!user;
  const role = user?.role || "member";

  // The server hands us permissions with every wildcard already expanded, so
  // checking access is a set lookup. There is deliberately no client-side
  // wildcard matching: that logic used to be duplicated from the server here,
  // which meant the two copies had to be kept in step and a permission renamed
  // on one side could silently diverge from the other.
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

  const hasPermission = useCallback(
    (key) => isSuperuser || permissionSet.has(key),
    [permissionSet, isSuperuser]
  );

  // Whether the user can see the Admin section at all.
  const canAccessAdmin = useMemo(
    () => isSuperuser || ADMIN_PERMISSIONS.some((p) => permissionSet.has(p)),
    [permissionSet, isSuperuser]
  );

  // Coarse "can do anything mutating" flag used for the read-only banner.
  const canWrite = useMemo(
    () => isSuperuser || permissions.some((p) => p.endsWith("*") || WRITE_SUFFIX.test(p)),
    [permissions, isSuperuser]
  );

  const isAdmin = isSuperuser;

  const applyAuth = useCallback((data) => {
    const perms = Array.isArray(data.permissions) ? data.permissions : [];
    const superuser = !!data.is_superuser;
    localStorage.setItem(AUTH_PERMS_KEY, JSON.stringify(perms));
    localStorage.setItem("nineteen_superuser", superuser ? "true" : "false");
    setPermissions(perms);
    setIsSuperuser(superuser);
  }, []);

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const meWith = (tok) =>
      fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
    (async () => {
      try {
        let tok = storedToken;
        let res = await meWith(tok);
        if (res.status === 401) {
          // Short-lived access token expired mid-session: try one silent
          // refresh before giving up. A disabled/deleted account fails
          // refresh too (status + version checks), which correctly ends
          // the session here.
          const refreshToken = localStorage.getItem(AUTH_REFRESH_KEY);
          if (refreshToken) {
            const rres = await fetch(`${API_URL}/api/auth/refresh`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refresh_token: refreshToken }),
            });
            if (rres.ok) {
              const rdata = await rres.json();
              if (rdata.token) {
                storeSession(rdata);
                tok = rdata.token;
                res = await meWith(tok);
              } else {
                throw Object.assign(new Error("Invalid token"), { definitive: true });
              }
            } else {
              throw Object.assign(new Error("Invalid token"), { definitive: true });
            }
          } else {
            throw Object.assign(new Error("Invalid token"), { definitive: true });
          }
        }
        // Only a definitive auth rejection ends the session. A network error
        // or a 5xx (e.g. the server is briefly busy during a deploy) must not
        // log the user out.
        if (res.status === 401 || res.status === 403) {
          throw Object.assign(new Error("Invalid token"), { definitive: true });
        }
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const userData = await res.json();
        if (cancelled) return;
        setUser(userData);
        setToken(tok);
        applyAuth(userData);
      } catch (err) {
        if (cancelled) return;
        if (err && err.definitive) {
          clearSession();
          queryClientInstance.clear();
          setToken(null);
          setUser(null);
          setPermissions([]);
          setIsSuperuser(false);
        }
        // Otherwise keep the stored session; the user stays signed in and the
        // next successful /me call refreshes it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyAuth]);

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error || "Login failed" };
    }

    storeSession(data);
    queryClientInstance.clear();
    setToken(data.token);
    setUser(data.user);
    applyAuth(data);
    return { success: true };
  }, [applyAuth]);

  const register = useCallback(async (inviteCode, username, email, password, displayName) => {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invite_code: inviteCode,
        username,
        email,
        password,
        display_name: displayName || username,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error || "Registration failed" };
    }

    storeSession(data);
    queryClientInstance.clear();
    setToken(data.token);
    setUser(data.user);
    applyAuth(data);
    return { success: true };
  }, [applyAuth]);

  const logout = useCallback(async () => {
    // Best-effort server revocation so the access jti lands in the
    // blacklist even if the token still has minutes left. Local state is
    // cleared regardless — logout must never fail because the network did.
    try {
      const tok = localStorage.getItem(AUTH_TOKEN_KEY);
      const refreshToken = localStorage.getItem(AUTH_REFRESH_KEY);
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
      });
    } catch {
      // ignore — local logout below is the guarantee
    }
    clearSession();
    queryClientInstance.clear();
    setToken(null);
    setUser(null);
    setPermissions([]);
    setIsSuperuser(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        loading,
        login,
        register,
        logout,
        role,
        isAdmin,
        isSuperuser,
        permissions,
        hasPermission,
        canAccessAdmin,
        canWrite,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

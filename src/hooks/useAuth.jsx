import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { queryClientInstance } from "@/lib/query-client";

const AuthContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || "";
const AUTH_TOKEN_KEY = "nineteen_token";
const AUTH_USER_KEY = "nineteen_user";
const AUTH_PERMS_KEY = "nineteen_permissions";

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

// Covers checks a granted permission against a required key, honouring the
// global "*" and prefix wildcards such as "projects.*".
export function permissionCovers(granted, required) {
  if (granted === "*" || granted === required) return true;
  if (granted.endsWith(".*")) {
    const prefix = granted.slice(0, -2);
    return required === prefix || required.startsWith(prefix + ".");
  }
  return false;
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

  const hasPermission = useCallback(
    (key) => {
      if (isSuperuser) return true;
      return permissions.some((p) => permissionCovers(p, key));
    },
    [permissions, isSuperuser]
  );

  // Whether the user can see the Admin section at all.
  const canAccessAdmin =
    isSuperuser || permissions.some((p) => p === "*" || p.startsWith("admin"));

  // Coarse "can do anything mutating" flag used for the read-only banner.
  const canWrite =
    isSuperuser ||
    permissions.some((p) => {
      if (p === "*" || p.endsWith(".*")) return true;
      return /\.(create|update|delete|manage|deploy|run)$/.test(p);
    });

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
    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then((res) => {
        // Only a definitive auth rejection ends the session. A network error
        // or a 5xx (e.g. the server is briefly busy during a deploy) must not
        // log the user out.
        if (res.status === 401 || res.status === 403) {
          const err = new Error("Invalid token");
          err.definitive = true;
          throw err;
        }
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then((userData) => {
        if (cancelled) return;
        setUser(userData);
        setToken(storedToken);
        applyAuth(userData);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err && err.definitive) {
          localStorage.removeItem(AUTH_TOKEN_KEY);
          localStorage.removeItem(AUTH_USER_KEY);
          localStorage.removeItem(AUTH_PERMS_KEY);
          localStorage.removeItem("nineteen_superuser");
          queryClientInstance.clear();
          setToken(null);
          setUser(null);
          setPermissions([]);
          setIsSuperuser(false);
        }
        // Otherwise keep the stored session; the user stays signed in and the
        // next successful /me call refreshes it.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

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

    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
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

    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
    queryClientInstance.clear();
    setToken(data.token);
    setUser(data.user);
    applyAuth(data);
    return { success: true };
  }, [applyAuth]);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_PERMS_KEY);
    localStorage.removeItem("nineteen_superuser");
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

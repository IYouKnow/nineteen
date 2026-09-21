import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { queryClientInstance } from "@/lib/query-client";

const AuthContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || "";
const AUTH_TOKEN_KEY = "nineteen_token";
const AUTH_USER_KEY = "nineteen_user";

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  const [token, setToken] = useState(getStoredToken);
  const [loading, setLoading] = useState(true);

  const isAuthenticated = !!token && !!user;
  const role = user?.role || "member";
  const isAdmin = role === "admin";
  const canWrite = role !== "viewer";

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
      })
      .catch((err) => {
        if (cancelled) return;
        if (err && err.definitive) {
          localStorage.removeItem(AUTH_TOKEN_KEY);
          localStorage.removeItem(AUTH_USER_KEY);
          queryClientInstance.clear();
          setToken(null);
          setUser(null);
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
  }, []);

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
    return { success: true };
  }, []);

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
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    queryClientInstance.clear();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, loading, login, register, logout, role, isAdmin, canWrite }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

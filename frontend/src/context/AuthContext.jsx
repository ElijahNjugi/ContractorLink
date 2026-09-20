import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, loginUser } from "../api/auth";
import client, { attachAuthToken } from "../api/client";
import { disconnectRealtime } from "../realtime/socket";

const STORAGE_KEY = "contractorlink.auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setIsLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      if (!parsed?.token) {
        setIsLoading(false);
        return;
      }

      setToken(parsed.token);
      attachAuthToken(parsed.token);
      fetchCurrentUser()
        .then((data) => setUser(data.user))
        .catch(() => {
          window.localStorage.removeItem(STORAGE_KEY);
          attachAuthToken(null);
          setToken(null);
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const interceptor = client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          window.localStorage.removeItem(STORAGE_KEY);
          attachAuthToken(null);
          setToken(null);
          setUser(null);
        }
        return Promise.reject(error);
      }
    );

    return () => client.interceptors.response.eject(interceptor);
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      isLoading,
      isAuthenticated: Boolean(token && user),
      async login(credentials) {
        const data = await loginUser(credentials);
        setToken(data.token);
        setUser(data.user);
        attachAuthToken(data.token);
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ token: data.token })
        );
        return data;
      },
      logout() {
        disconnectRealtime();
        setToken(null);
        setUser(null);
        attachAuthToken(null);
        window.localStorage.removeItem(STORAGE_KEY);
      },
      setUser,
    }),
    [isLoading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

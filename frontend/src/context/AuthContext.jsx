import { createContext, useContext, useEffect, useState } from 'react';
import { api, onSessionEnded } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('shine_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => localStorage.removeItem('shine_token'))
      .finally(() => setLoading(false));
  }, []);

  // When the server refuses a token, drop the user here rather than letting
  // the interceptor drive the browser. ProtectedRoute does the rest.
  useEffect(() => onSessionEnded(() => setUser(null)), []);

  async function login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('shine_token', res.data.token);
    setUser(res.data.user);
    return res.data.user;
  }

  function logout() {
    localStorage.removeItem('shine_token');
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAdmin: user?.role === 'ADMIN',
        // The field role. It reaches collections and local suppliers and
        // nothing else — the server enforces that (CONTRACTOR_ALLOWED in
        // middleware/auth.js); this only stops the app offering doors that
        // would answer 403, which reads as the app being broken.
        isContractor: user?.role === 'CONTRACTOR',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

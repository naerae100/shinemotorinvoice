import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('shine_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * The server slides a session that is still in use: past the halfway point of
 * its life, an authenticated response carries a fresh token. Swapping it in
 * here is what stops the tablet logging itself out mid-shift — see
 * issueSlidingToken in the backend's auth middleware.
 */
api.interceptors.response.use(
  (res) => {
    const renewed = res.headers?.['x-refreshed-token'];
    if (renewed) localStorage.setItem('shine_token', renewed);
    return res;
  },
  (err) => {
    // Only an expired or withdrawn session ends the session. A 429 from the
    // login rate limiter must not, or a locked-out user is redirected in a
    // loop with no way to read the message telling them to wait — and a 401
    // from the sign-in form itself is "wrong password", not "signed out".
    const isSignInAttempt = /\/auth\/login$/.test(err.config?.url ?? '');
    if (err.response?.status === 401 && !isSignInAttempt) {
      localStorage.removeItem('shine_token');
      endSession();
    }
    return Promise.reject(err);
  }
);

/**
 * What happens when the server says the session is over.
 *
 * This used to be `window.location.href = '/login'`, straight from the
 * interceptor, and it made the back button unusable. Assigning to href
 * *pushes* a history entry, so every 401 stacked another /login on the pile:
 * pressing Back landed on a protected page, which 401'd, which pushed
 * /login again. You could never get back past the moment your session
 * ended, and it read as "the app logs me out when I use the back button".
 *
 * It also threw away the whole single-page app and reloaded the bundle to
 * change one screen.
 *
 * So React is told instead, and the router handles it with a replace — see
 * ProtectedRoute. The window fallback stays for the moment before React has
 * mounted, and it replaces rather than pushes.
 */
let sessionEndedHandler = null;

export function onSessionEnded(fn) {
  sessionEndedHandler = fn;
  return () => {
    if (sessionEndedHandler === fn) sessionEndedHandler = null;
  };
}

function endSession() {
  if (sessionEndedHandler) return sessionEndedHandler();
  if (window.location.pathname !== '/login') window.location.replace('/login');
}

export const uploadSettingsImage = async (type, file) => {
  const formData = new FormData();
  formData.append('type', type);
  formData.append('file', file);
  const res = await api.post('/settings/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

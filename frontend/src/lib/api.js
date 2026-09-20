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
    // Only an expired/invalid session should bounce the user to login. A 429 from
    // the login rate limiter must not, or a locked-out user gets redirected in a
    // loop with no way to read the message telling them to wait.
    if (err.response?.status === 401) {
      localStorage.removeItem('shine_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export const uploadSettingsImage = async (type, file) => {
  const formData = new FormData();
  formData.append('type', type);
  formData.append('file', file);
  const res = await api.post('/settings/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

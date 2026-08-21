import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      // A bare catch here used to report every failure as bad credentials —
      // including the API being unreachable, which sent people hunting for a
      // password problem that didn't exist.
      if (!err.response) {
        setError('Cannot reach the server. Check that the backend is running.');
      } else if (err.response.status === 429) {
        setError(
          err.response.data?.error || 'Too many sign-in attempts. Try again in 15 minutes.'
        );
      } else if (err.response.status === 401) {
        setError('Incorrect email or password.');
      } else {
        setError('Something went wrong signing in. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-steel-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <svg viewBox="0 0 32 32" className="mx-auto mb-3 h-9 w-9 text-copper-400" fill="none" aria-hidden="true">
            <path d="M2 20c3-4 6-4 9 0s6 4 9 0 6-4 9 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M2 13c3-4 6-4 9 0s6 4 9 0 6-4 9 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
          </svg>
          <h1 className="font-display text-2xl font-semibold text-paper">Shine Metals</h1>
          <p className="mt-1 text-sm text-steel-400">Docket & invoice system</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-steel-700/60 bg-steel-800/50 p-6 shadow-ticket"
        >
          <div className="mb-4">
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-steel-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-steel-600 bg-steel-900 px-3 py-2 text-paper placeholder-steel-500 focus:border-copper-500"
              placeholder="you@shinemotor.com.au"
            />
          </div>
          <div className="mb-5">
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-steel-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-steel-600 bg-steel-900 px-3 py-2 text-paper placeholder-steel-500 focus:border-copper-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-md bg-working-red/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 transition-colors hover:bg-copper-400 disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getPublicBranding } from '../lib/settings';

/** The wave from the logo, reused as a large watermark on the brand panel. */
function WaveMark({ className }) {
  return (
    <svg viewBox="0 0 120 40" className={className} fill="none" aria-hidden="true">
      <path
        d="M2 30c9-14 18-14 27 0s18 14 27 0 18-14 27 0 18 14 27 0"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M2 20c9-14 18-14 27 0s18 14 27 0 18-14 27 0 18 14 27 0"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M2 10c9-14 18-14 27 0s18 14 27 0 18-14 27 0 18 14 27 0"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.25"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Trading identity from the public branding endpoint — nobody is signed in
  // yet, so this must not be the authenticated settings read. Falls back to
  // sensible defaults if it fails.
  const [company, setCompany] = useState(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    getPublicBranding().then(setCompany);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      // Report what actually went wrong. A bare catch here used to call every
      // failure "wrong password", including the server being unreachable, which
      // sent people hunting for a problem that didn't exist.
      if (!err.response) {
        setError('Cannot reach the server. Check your connection and try again.');
      } else if (err.response.status === 429) {
        setError(err.response.data?.error || 'Too many sign-in attempts. Try again in 15 minutes.');
      } else if (err.response.status === 401) {
        setError('Incorrect email or password.');
      } else {
        setError('Something went wrong signing in. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const companyName = company?.companyName || 'Shine Motor Corporation Pty Ltd';

  return (
    <div className="flex min-h-screen flex-col bg-paper lg:flex-row">
      {/* ── Brand panel ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-steel-950 px-8 py-10 text-paper lg:w-[46%] lg:px-14 lg:py-14">
        {/* Watermark, deliberately low contrast so it never competes with text */}
        <WaveMark className="pointer-events-none absolute -right-16 top-1/2 hidden w-[560px] -translate-y-1/2 text-copper-500/[0.07] lg:block" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, #fff 0 1px, transparent 1px 9px)',
          }}
          aria-hidden="true"
        />

        <div className="relative flex h-full flex-col">
          <div className="flex items-center gap-3">
            <WaveMark className="h-7 w-20 text-copper-400 lg:hidden" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-copper-400 lg:hidden">
              Shine Motor
            </span>
          </div>

          <div className="hidden lg:block">
            <WaveMark className="mb-8 h-10 w-28 text-copper-400" />
            <h1 className="font-display text-[2.6rem] font-semibold leading-[1.1] text-paper">
              Docket &amp;<br />invoice system
            </h1>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-steel-300">
              Scrap metal purchasing, tax invoicing and container export — the paper
              pad, done properly.
            </p>

            <ul className="mt-8 space-y-2.5 text-sm text-steel-300">
              {[
                'Weighbridge dockets with live totals',
                'GST and discounts handled per document',
                'Export invoices with bank details snapshotted',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-copper-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-auto hidden pt-10 text-xs leading-relaxed text-steel-500 lg:block">
            <div className="font-medium text-steel-400">{companyName}</div>
            {company?.address && <div>{company.address}</div>}
            <div className="num">
              {[company?.abn && `ABN ${company.abn}`, company?.phone].filter(Boolean).join('  ·  ')}
            </div>
          </div>
        </div>
      </div>

      {/* ── Sign-in panel ───────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-12 lg:px-10">
        <div className="w-full max-w-[380px]">
          {/* The logo is a red-and-blue wordmark, so it lives on the light side
              where it reads correctly rather than on the dark panel. */}
          <img
            src="/branding/logo.png"
            alt={companyName}
            className="mb-8 h-11 object-contain object-left"
          />

          <h2 className="font-display text-2xl font-semibold text-steel-900">Sign in</h2>
          <p className="mt-1 text-sm text-steel-500">
            Use the account your administrator set up for you.
          </p>

          <form onSubmit={handleSubmit} className="mt-7">
            <div className="mb-4">
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-steel-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-steel-200 bg-white px-3.5 py-2.5 text-steel-900 shadow-sm transition-colors placeholder:text-steel-400 focus:border-copper-500 focus:outline-none focus:ring-2 focus:ring-copper-500/20"
                placeholder="you@shinemotor.com.au"
              />
            </div>

            <div className="mb-5">
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-steel-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-steel-200 bg-white px-3.5 py-2.5 pr-16 text-steel-900 shadow-sm transition-colors placeholder:text-steel-400 focus:border-copper-500 focus:outline-none focus:ring-2 focus:ring-copper-500/20"
                  placeholder="••••••••"
                />
                {/* Yard terminals are often touchscreens with gloves on — being
                    able to check what was typed saves a lockout. */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-xs font-semibold text-steel-500 hover:text-copper-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2.5 rounded-lg border border-working-red/25 bg-working-redDim px-3.5 py-2.5 text-sm text-working-red"
              >
                <svg viewBox="0 0 20 20" className="mt-px h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 5a1 1 0 112 0v5a1 1 0 11-2 0V5zm1 9.5a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-copper-500 px-4 py-3 text-sm font-semibold text-steel-950 shadow-sm transition-colors hover:bg-copper-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-steel-950/30 border-t-steel-950" />
              )}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-8 border-t border-steel-200 pt-5 text-xs leading-relaxed text-steel-400">
            Forgotten your password? An administrator can reset it from
            <span className="font-medium text-steel-500"> Staff &amp; logins</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

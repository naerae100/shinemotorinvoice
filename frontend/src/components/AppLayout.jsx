import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Grouped by what the yard actually does, rather than one entry per screen.
 */
const NAV_GROUPS = [
  { items: [{ to: '/', label: 'Dashboard', end: true }] },
  {
    title: 'Buying',
    // Dockets and tax invoices live in one history, filtered on the page.
    items: [{ to: '/purchases', label: 'Purchases' }],
  },
  { title: 'Selling', items: [{ to: '/export-invoices', label: 'Sales invoices' }] },
  {
    title: 'Records',
    items: [
      { to: '/clients', label: 'Clients' },
      { to: '/buyers', label: 'Buyers' },
      { to: '/materials', label: 'Materials & pricing' },
    ],
  },
];

const ADMIN_ITEMS = [
  { to: '/users', label: 'Staff & logins' },
  { to: '/settings', label: 'Settings' },
];

const linkClass = ({ isActive }) =>
  `block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2 ${
    isActive
      ? 'bg-steel-800 text-copper-300'
      : 'text-steel-300 hover:bg-steel-800/60 hover:text-paper'
  }`;

function SidebarContent({ isAdmin, user, onNavigate, onLogout }) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-steel-700/60 px-5 py-4">
        <img
          src="/branding/logo.png"
          alt="Shine Motor Corporation"
          className="h-8 w-auto max-w-[170px] object-contain object-left"
        />
        {/* Close control only exists in the mobile drawer */}
        <button
          onClick={onNavigate}
          className="-mr-1 rounded-md p-1.5 text-steel-400 hover:bg-steel-800 hover:text-paper lg:hidden"
          aria-label="Close menu"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-3 pt-4">
        <Link
          to="/purchases/new"
          onClick={onNavigate}
          className="block rounded-lg bg-copper-500 px-3 py-2.5 text-center text-sm font-semibold text-steel-950 transition-colors hover:bg-copper-400"
        >
          + New purchase
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title || gi} className={gi > 0 ? 'pt-3' : ''}>
            {group.title && (
              <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-steel-500">
                {group.title}
              </div>
            )}
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}

        {isAdmin && (
          <div className="pt-3">
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-steel-500">
              Admin
            </div>
            {ADMIN_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={onNavigate} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className="border-t border-steel-700/60 px-4 py-4">
        <div className="mb-2 px-1">
          <div className="truncate text-sm font-medium text-paper">{user?.name}</div>
          <div className="text-xs text-steel-400">
            {user?.role === 'ADMIN' ? 'Administrator' : 'Staff'}
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-steel-400 transition-colors hover:bg-steel-800/60 hover:text-paper"
        >
          Sign out
        </button>
      </div>
    </>
  );
}

/**
 * App shell.
 *
 * The sidebar used to be a fixed 256px column with no responsive handling at
 * all, which on a 400px phone left the actual page about 140px wide. Below lg
 * it is now an off-canvas drawer behind a top bar; from lg up it is the static
 * column it always was.
 */
export default function AppLayout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Never leave the drawer covering the page the user just navigated to.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Stop the page behind the drawer scrolling under it on touch devices.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper lg:flex-row">
      {/* ── Mobile top bar ──────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-steel-700/60 bg-steel-900 px-4 py-3 lg:hidden print:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          className="-ml-1 rounded-md p-2 text-steel-300 hover:bg-steel-800 hover:text-paper"
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
          </svg>
        </button>
        <img
          src="/branding/logo.png"
          alt="Shine Motor Corporation"
          className="h-6 w-auto max-w-[140px] object-contain"
        />
        <Link
          to="/purchases/new"
          className="ml-auto rounded-lg bg-copper-500 px-3 py-1.5 text-xs font-semibold text-steel-950"
        >
          + New
        </Link>
      </header>

      {/* ── Drawer (below lg) ───────────────────────────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden">
          <div
            className="absolute inset-0 bg-steel-950/60"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col bg-steel-900 text-paper shadow-2xl">
            <SidebarContent
              isAdmin={isAdmin}
              user={user}
              onNavigate={() => setMenuOpen(false)}
              onLogout={handleLogout}
            />
          </aside>
        </div>
      )}

      {/* ── Static sidebar (lg and up) ──────────────────────────── */}
      <aside className="hidden w-64 flex-shrink-0 flex-col bg-steel-900 text-paper lg:flex print:hidden">
        <SidebarContent isAdmin={isAdmin} user={user} onNavigate={undefined} onLogout={handleLogout} />
      </aside>

      {/* min-w-0 matters: without it a wide table inside a flex child forces the
          whole layout wider instead of scrolling within its own container. */}
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}

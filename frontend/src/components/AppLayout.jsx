import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Grouped by what the yard actually does, rather than one entry per screen.
 */
/**
 * Line icons, one per destination.
 *
 * Collapsed to a rail the labels are gone, and the first letter is not a
 * substitute for them: Purchases and Packing slips are both "P", Sales invoices,
 * Staff and Settings are all "S". A shape is distinguishable at a glance where a
 * letter is not. Drawn inline rather than pulled from an icon package so the
 * rail costs nothing to load, and on one 24px grid with one stroke weight so
 * they read as a set.
 */
const ICONS = {
  dashboard: 'M4 5h6v6H4zM14 5h6v4h-6zM14 13h6v6h-6zM4 15h6v4H4z',
  purchases: 'M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  slips: 'M9 4h6v3H9zM6 6h2m8 0h2v14H6V6zM9 12h6M9 16h4',
  invoices: 'M6 3h9l3 3v15H6zM14 3v4h4M9 12h6M9 16h6',
  clients: 'M8 11a3 3 0 100-6 3 3 0 000 6zM3 20a5 5 0 0110 0M16 11a3 3 0 100-6M17 20a5 5 0 00-3-4.6',
  buyers: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3.5 9h17M3.5 15h17M12 3a15 15 0 010 18 15 15 0 010-18z',
  materials: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  staff: 'M12 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 21a7 7 0 0114 0',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 14a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2 2 2 0 11-4 0 1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 004 14a2 2 0 110-4 1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0011 3.2a2 2 0 114 0A1.7 1.7 0 0017.9 4.4l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0020 10a2 2 0 110 4z',
};

function NavIcon({ name, className = 'h-5 w-5' }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const NAV_GROUPS = [
  { items: [{ to: '/', label: 'Dashboard', icon: 'dashboard', end: true }] },
  {
    title: 'Buying',
    // Dockets and tax invoices live in one history, filtered on the page.
    items: [{ to: '/purchases', label: 'Purchases', icon: 'purchases' }],
  },
    {
    title: 'Selling',
    // In the order the work actually happens: the goods are weighed onto a
    // packing slip first, and the invoice prices what the slip established.
    items: [
      { to: '/packing-slips', label: 'Packing slips', icon: 'slips' },
      { to: '/export-invoices', label: 'Sales invoices', icon: 'invoices' },
    ],
  },
  {
    title: 'Records',
    items: [
      { to: '/clients', label: 'Clients', icon: 'clients' },
      { to: '/buyers', label: 'Buyers', icon: 'buyers' },
      { to: '/materials', label: 'Materials & pricing', icon: 'materials' },
    ],
  },
];

const ADMIN_ITEMS = [
  { to: '/users', label: 'Staff & logins', icon: 'staff' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

const linkClass = ({ isActive }) =>
  `block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2 ${
    isActive
      ? 'bg-steel-800 text-copper-300'
      : 'text-steel-300 hover:bg-steel-800/60 hover:text-paper'
  }`;

function SidebarContent({ isAdmin, user, onNavigate, onLogout, collapsed = false, onToggleCollapse }) {
  return (
    <>
      <div
        className={`flex items-center border-b border-steel-700/60 py-4 ${
          collapsed ? 'justify-center px-2' : 'justify-between px-5'
        }`}
      >
        {!collapsed && (
          <img
            src="/branding/logo.png"
            alt="Shine Motor Corporation"
            className="h-8 w-auto max-w-[170px] object-contain object-left"
          />
        )}

        {/* Desktop only: the drawer below lg has its own close control. */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-md p-1.5 text-steel-400 transition-colors hover:bg-steel-800 hover:text-paper lg:block"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path
                d={collapsed ? 'M7 4l6 6-6 6' : 'M13 4l-6 6 6 6'}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
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

      <div className={collapsed ? 'px-2 pt-4' : 'px-3 pt-4'}>
        <Link
          to="/purchases/new"
          onClick={onNavigate}
          title={collapsed ? 'New purchase' : undefined}
          className={`block rounded-lg bg-copper-500 text-center text-sm font-semibold text-white transition-colors hover:bg-copper-400 ${
            collapsed ? 'px-0 py-2.5' : 'px-3 py-2.5'
          }`}
        >
          {collapsed ? '+' : '+ New purchase'}
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title || gi} className={gi > 0 ? 'pt-3' : ''}>
            {group.title &&
              (collapsed ? (
                <div className="mx-3 mb-1 border-t border-steel-700/60" />
              ) : (
                <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-steel-400">
                  {group.title}
                </div>
              ))}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={linkClass}
              >
                {collapsed ? (
                  <NavIcon name={item.icon} className="mx-auto h-5 w-5" />
                ) : (
                  <span className="flex items-center gap-2.5">
                    <NavIcon name={item.icon} className="h-[18px] w-[18px] shrink-0 opacity-80" />
                    {item.label}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}

        {isAdmin && (
          <div className="pt-3">
            {collapsed ? (
              <div className="mx-3 mb-1 border-t border-steel-700/60" />
            ) : (
              <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-steel-400">
                Admin
              </div>
            )}
            {ADMIN_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={linkClass}
              >
                {collapsed ? (
                  <NavIcon name={item.icon} className="mx-auto h-5 w-5" />
                ) : (
                  <span className="flex items-center gap-2.5">
                    <NavIcon name={item.icon} className="h-[18px] w-[18px] shrink-0 opacity-80" />
                    {item.label}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className={`border-t border-steel-700/60 py-4 ${collapsed ? 'px-2' : 'px-4'}`}>
        {!collapsed && (
          <div className="mb-2 px-1">
            <div className="truncate text-sm font-semibold text-paper">{user?.name}</div>
            <div className="text-xs text-steel-300">
              {user?.role === 'ADMIN' ? 'Administrator' : 'Staff'}
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          title={collapsed ? 'Sign out' : undefined}
          className={`w-full rounded-lg py-2 text-sm text-steel-300 transition-colors hover:bg-steel-800/60 hover:text-paper ${
            collapsed ? 'px-0 text-center' : 'px-3 text-left'
          }`}
        >
          {collapsed ? (
            <svg viewBox="0 0 20 20" className="mx-auto h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 16H5a1 1 0 01-1-1V5a1 1 0 011-1h3M13 13l3-3-3-3M16 10H8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            'Sign out'
          )}
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
  // Remembered per browser: someone who works from a narrow laptop collapses it
  // once and expects it to stay that way, and it is a per-person preference
  // rather than anything that belongs to the account.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('shine.sidebarCollapsed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('shine.sidebarCollapsed', collapsed ? '1' : '0');
    } catch {
      /* private window, or storage blocked — the toggle still works for now */
    }
  }, [collapsed]);

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
          className="ml-auto rounded-lg bg-copper-500 px-3 py-1.5 text-xs font-semibold text-white"
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

      {/* ── Static sidebar (lg and up) ──────────────────────────────
          Sticky and exactly one viewport tall, with the nav scrolling inside it.
          It used to be an ordinary flex child, so on a long page — the dashboard
          above all — the column grew to the height of the whole page and the
          footer holding the signed-in user and Sign out ended up two thousand
          pixels down, off screen. Anchoring it to the viewport is also what lets
          it collapse without the content jumping. */}
      <aside
        className={`sticky top-0 hidden h-screen flex-shrink-0 flex-col bg-steel-900 text-paper transition-[width] duration-200 lg:flex print:hidden ${
          collapsed ? 'w-[4.5rem]' : 'w-64'
        }`}
      >
        <SidebarContent
          isAdmin={isAdmin}
          user={user}
          onNavigate={undefined}
          onLogout={handleLogout}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </aside>

      {/* min-w-0 matters: without it a wide table inside a flex child forces the
          whole layout wider instead of scrolling within its own container. */}
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}

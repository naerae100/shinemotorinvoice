import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Grouped by what the yard actually does, rather than one entry per screen.
 * The old flat list paired "New X" and "X" for every document type, which made
 * nine items out of four real areas and buried Clients and Materials.
 */
const NAV_GROUPS = [
  {
    items: [{ to: '/', label: 'Dashboard', end: true }],
  },
  {
    title: 'Buying',
    items: [
      { to: '/purchases', label: 'Purchases' },
      { to: '/tax-invoices', label: 'Tax invoices' },
    ],
  },
  {
    title: 'Selling',
    items: [{ to: '/export-invoices', label: 'Sales invoices' }],
  },
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

// WaveMark removed in favor of real logo image

export default function AppLayout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-64 flex-shrink-0 flex-col bg-steel-900 text-paper print:hidden">
        <div className="flex items-center gap-2.5 border-b border-steel-700/60 px-6 py-5">
          <img src="/branding/logo.png" alt="Shine Motor Logo" className="w-full max-w-[180px] object-contain" />
        </div>

        <div className="px-3 pt-4">
          <Link
            to="/purchases/new"
            className="block rounded-md bg-copper-500 px-3 py-2.5 text-center text-sm font-semibold text-steel-950 transition-colors hover:bg-copper-400"
          >
            + New purchase
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.title || gi} className={gi > 0 ? 'pt-3' : ''}>
              {group.title && (
                <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-steel-500">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-steel-800 text-copper-300'
                        : 'text-steel-300 hover:bg-steel-800/60 hover:text-paper'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}

          {isAdmin && (
            <>
              <div className="mb-1 mt-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-steel-500">
                Admin
              </div>
              {ADMIN_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-steel-800 text-copper-300'
                        : 'text-steel-300 hover:bg-steel-800/60 hover:text-paper'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="border-t border-steel-700/60 px-4 py-4">
          <div className="mb-2 px-1">
            <div className="text-sm font-medium text-paper">{user?.name}</div>
            <div className="text-xs text-steel-400">
              {user?.role === 'ADMIN' ? 'Administrator' : 'Staff'}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full rounded-md px-3 py-1.5 text-left text-sm text-steel-400 transition-colors hover:bg-steel-800/60 hover:text-paper"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

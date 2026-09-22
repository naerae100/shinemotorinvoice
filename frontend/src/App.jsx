import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import AppLayout from './components/AppLayout';

// Login is eager — it is the first paint and must not wait on anything.
import LoginPage from './pages/LoginPage';

// Everything behind the login is split out. The charting library alone is most
// of the bundle, and none of it is needed to render the sign-in screen.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CollectionsPage = lazy(() => import('./pages/CollectionsPage'));
const NewCollectionPage = lazy(() => import('./pages/NewCollectionPage'));
const CollectionDetailPage = lazy(() => import('./pages/CollectionDetailPage'));
const SharedCollectionPage = lazy(() => import('./pages/SharedCollectionPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const LocalSuppliersPage = lazy(() => import('./pages/LocalSuppliersPage'));
const LocalSupplierDetailPage = lazy(() => import('./pages/LocalSupplierDetailPage'));
const NewDocketPage = lazy(() => import('./pages/NewDocketPage'));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'));
const DocketDetailPage = lazy(() => import('./pages/DocketDetailPage'));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'));
const NewInvoicePage = lazy(() => import('./pages/NewInvoicePage'));
const InvoiceDetailPage = lazy(() => import('./pages/InvoiceDetailPage'));
const MaterialsPage = lazy(() => import('./pages/MaterialsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const ConsigneesPage = lazy(() => import('./pages/ConsigneesPage'));
const PartyDetailPage = lazy(() => import('./pages/PartyDetailPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));

function PageFallback() {
  return <div className="px-8 py-8 text-sm text-steel-500">Loading…</div>;
}

/** Carries the :id across when an old party URL is followed. */
function RedirectParty({ to }) {
  const { id } = useParams();
  return <Navigate to={`/${to}/${id}`} replace />;
}

/**
 * Where "/" goes.
 *
 * The dashboard reads /api/reports, which a contractor is not allowed to
 * touch, so sending them there would greet them with "Could not load
 * dashboard data" every time they open the app. They get their own list
 * instead, which is the only screen they have.
 */
function HomeForRole() {
  const { isContractor } = useAuth();
  return isContractor ? <Navigate to="/collections" replace /> : <DashboardPage />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Outside ProtectedRoute on purpose: the seller has no account,
                and the signed token in the path is the whole credential. */}
            <Route path="/shared/collection/:token" element={<SharedCollectionPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<PageFallback />}>
                    <AppLayout />
                  </Suspense>
                </ProtectedRoute>
              }
            >
              {/* A contractor has no dashboard — the endpoints behind it are
                  closed to them — so the index route sends them to their own
                  work rather than to a screen that would load as an error. */}
              <Route index element={<HomeForRole />} />

              {/* ── Field collections ──────────────────────────────── */}
              {/* Open to every role — a contractor cannot reach Staff & logins. */}
              <Route path="account" element={<AccountPage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="collections/new" element={<NewCollectionPage key="new-collection" />} />
              <Route path="collections/:id" element={<CollectionDetailPage />} />
              <Route
                path="collections/:id/edit"
                element={<NewCollectionPage key="edit-collection" />}
              />
              <Route path="local-suppliers" element={<LocalSuppliersPage />} />
              {/* The same catalogue screen, pinned to the field grades and
                  reached from the Field group rather than from Materials &
                  pricing — these are weighed, not priced. Admin only: a
                  contractor uses the list, they do not curate it. */}
              <Route
                path="collection-materials"
                element={
                  <ProtectedRoute adminOnly>
                    <MaterialsPage key="collection-grades" fixedKind="COLLECTION" />
                  </ProtectedRoute>
                }
              />
              <Route path="local-suppliers/:id" element={<LocalSupplierDetailPage />} />
              {/* Distinct keys: the purchase and tax-invoice variants are the same
                  component, so without these React reuses one instance and carries
                  stale search/page state across the switch. */}
              <Route
                path="purchases/new"
                element={<NewDocketPage key="purchase" defaultType="PURCHASE_DOCKET" />}
              />
              {/* One purchase history covering both document types, narrowed
                  by the filters on the page rather than by separate routes. */}
              <Route path="purchases" element={<PurchasesPage />} />
              <Route path="purchases/:id" element={<DocketDetailPage />} />
              <Route
                path="purchases/:id/edit"
                element={<NewDocketPage key="purchase-edit" defaultType="PURCHASE_DOCKET" />}
              />
              <Route
                path="tax-invoices/new"
                element={<NewDocketPage key="tax" defaultType="TAX_INVOICE" />}
              />
              {/* Kept so old links and bookmarks still land somewhere sensible */}
              <Route
                path="tax-invoices"
                element={<Navigate to="/purchases?type=TAX_INVOICE" replace />}
              />
              <Route path="tax-invoices/:id" element={<DocketDetailPage />} />
              <Route
                path="tax-invoices/:id/edit"
                element={<NewDocketPage key="tax-edit" defaultType="TAX_INVOICE" />}
              />
              <Route path="export-invoices/new" element={<NewInvoicePage />} />
              <Route path="export-invoices" element={<InvoicesPage />} />

              {/* A packing slip is the same record at an earlier stage, so it
                  reuses the same three screens with the stage switched. */}
              <Route
                path="packing-slips/new"
                element={<NewInvoicePage key="slip-new" mode="packing" />}
              />
              <Route path="packing-slips" element={<InvoicesPage key="slips" stage="PACKING_SLIP" />} />
              <Route path="packing-slips/:id" element={<InvoiceDetailPage key="slip-detail" />} />
              <Route
                path="packing-slips/:id/edit"
                element={<NewInvoicePage key="slip-edit" mode="packing" />}
              />
              <Route path="export-invoices/:id" element={<InvoiceDetailPage />} />
              <Route path="export-invoices/:id/edit" element={<NewInvoicePage key="inv-edit" />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="suppliers/:id" element={<PartyDetailPage kind="supplier" />} />
              <Route path="consignees" element={<ConsigneesPage />} />
              <Route path="consignees/:id" element={<PartyDetailPage kind="consignee" />} />
              {/* The pages used to live at /clients and /buyers. Anything
                  already bookmarked, or a link pasted into an email, still
                  lands in the right place. */}
              <Route path="clients" element={<Navigate to="/suppliers" replace />} />
              <Route path="clients/:id" element={<RedirectParty to="suppliers" />} />
              <Route path="buyers" element={<Navigate to="/consignees" replace />} />
              <Route path="buyers/:id" element={<RedirectParty to="consignees" />} />
              <Route path="materials" element={<MaterialsPage />} />
              <Route
                path="users"
                element={
                  <ProtectedRoute adminOnly>
                    <UsersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="settings"
                element={
                  <ProtectedRoute adminOnly>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              {/* Anything unmatched lands on the dashboard rather than a blank frame */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

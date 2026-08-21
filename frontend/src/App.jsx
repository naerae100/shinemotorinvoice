import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import AppLayout from './components/AppLayout';

// Login is eager — it is the first paint and must not wait on anything.
import LoginPage from './pages/LoginPage';

// Everything behind the login is split out. The charting library alone is most
// of the bundle, and none of it is needed to render the sign-in screen.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NewDocketPage = lazy(() => import('./pages/NewDocketPage'));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'));
const DocketDetailPage = lazy(() => import('./pages/DocketDetailPage'));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'));
const NewInvoicePage = lazy(() => import('./pages/NewInvoicePage'));
const InvoiceDetailPage = lazy(() => import('./pages/InvoiceDetailPage'));
const MaterialsPage = lazy(() => import('./pages/MaterialsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const BuyersPage = lazy(() => import('./pages/BuyersPage'));
const PartyDetailPage = lazy(() => import('./pages/PartyDetailPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));

function PageFallback() {
  return <div className="px-8 py-8 text-sm text-steel-500">Loading…</div>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
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
              <Route index element={<DashboardPage />} />
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
              <Route path="export-invoices/:id" element={<InvoiceDetailPage />} />
              <Route path="export-invoices/:id/edit" element={<NewInvoicePage key="inv-edit" />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="clients/:id" element={<PartyDetailPage kind="supplier" />} />
              <Route path="buyers" element={<BuyersPage />} />
              <Route path="buyers/:id" element={<PartyDetailPage kind="consignee" />} />
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

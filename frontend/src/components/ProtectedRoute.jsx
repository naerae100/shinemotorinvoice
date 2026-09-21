import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { contractorMayVisit, CONTRACTOR_HOME } from '../lib/access';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin, isContractor } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-steel-500">
        Loading…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;

  // A contractor typing another screen's address into the bar got that
  // screen's shell — no data, because the server refuses it, but an empty
  // Purchases page all the same. This wraps the whole app shell, so one
  // check covers every route including ones added later.
  if (isContractor && !contractorMayVisit(location.pathname)) {
    return <Navigate to={CONTRACTOR_HOME} replace />;
  }

  return children;
}

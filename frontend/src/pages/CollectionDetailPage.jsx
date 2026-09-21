import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../lib/apiError';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * One pickup, as recorded.
 *
 * Shows who touched it as well as what it weighed. The contractor can correct
 * their own entry, which is the right trade for a weight typed beside a truck
 * — but only if the correction is visible afterwards, so who created it and
 * who last changed it sit on the record rather than only in the audit trail.
 */
export default function CollectionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    return api
      .get(`/collections/${id}`)
      .then((res) => {
        setCollection(res.data.collection);
        setError('');
      })
      .catch(() => setError('Could not load that collection.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runAction(path, body) {
    setBusy(true);
    try {
      await api.post(`/collections/${id}/${path}`, body);
      setDialog(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not do that.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="px-4 py-6 text-sm text-steel-500 sm:px-6 lg:px-8">Loading…</div>;
  }
  if (!collection) {
    return (
      <div className="px-4 py-6 text-sm text-working-red sm:px-6 lg:px-8">
        {error || 'Not found.'}
      </div>
    );
  }

  const isVoid = collection.status === 'VOID';
  const totalNet = collection.lines.reduce((a, l) => a + Number(l.netWeight), 0);
  const totalGross = collection.lines.reduce((a, l) => a + Number(l.grossWeight), 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-4">
        <Link to="/collections" className="text-sm font-medium text-copper-600">
          ← All collections
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      <div className="surface overflow-hidden">
        <div className="flex flex-col gap-3 bg-steel-900 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-base font-semibold text-paper">
              Collection #{collection.collectionNumber}
            </h1>
            <div className="text-xs text-steel-400">
              {format(new Date(collection.date), 'EEEE d MMMM yyyy, h:mma')}
            </div>
          </div>
          {isVoid && (
            <span className="self-start rounded bg-working-red px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
              Voided
            </span>
          )}
        </div>

        {isVoid && collection.voidReason && (
          <div className="border-b border-working-red/20 bg-working-redDim px-6 py-3 text-sm text-working-red">
            {collection.voidReason}
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-steel-100 px-6 py-5 sm:grid-cols-2">
          <Detail label="Collected from">
            <Link
              to={`/local-suppliers/${collection.localSupplier.id}`}
              className="font-semibold text-steel-900 hover:text-copper-600"
            >
              {collection.localSupplier.name}
            </Link>
            <div className="mt-0.5 text-xs text-steel-500">
              {[
                collection.localSupplier.address,
                collection.localSupplier.suburb,
                collection.localSupplier.state,
                collection.localSupplier.postcode,
              ]
                .filter(Boolean)
                .join(', ') || 'No address on file'}
            </div>
            {collection.localSupplier.phone && (
              <div className="num text-xs text-steel-500">{collection.localSupplier.phone}</div>
            )}
          </Detail>

          <Detail label="Recorded by">
            <div className="font-semibold text-steel-900">
              {collection.createdBy?.name ?? 'Unknown'}
            </div>
            {/* The whole point of letting a contractor edit: the change has to
                be visible without going to the audit trail to find it. */}
            {collection.editedBy && (
              <div className="mt-0.5 text-xs text-steel-500">
                Last edited by {collection.editedBy.name}
                {collection.editedAt &&
                  ` on ${format(new Date(collection.editedAt), 'd MMM yyyy, h:mma')}`}
              </div>
            )}
          </Detail>

          {collection.notes && (
            <Detail label="Notes" className="sm:col-span-2">
              <p className="text-sm leading-relaxed text-steel-700">{collection.notes}</p>
            </Detail>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-steel-100 bg-paper text-left text-[11px] uppercase tracking-wider text-steel-500">
                <th className="px-6 py-3 font-semibold">Grade</th>
                <th className="px-6 py-3 text-right font-semibold">Gross kg</th>
                <th className="px-6 py-3 text-right font-semibold">Tare kg</th>
                <th className="px-6 py-3 text-right font-semibold">Net kg</th>
              </tr>
            </thead>
            <tbody>
              {collection.lines.map((l) => (
                <tr key={l.id} className="data-row">
                  <td className="px-6 py-3 text-steel-800">
                    {l.material?.description ?? l.description}
                    {!l.material && (
                      <span className="ml-2 text-xs text-steel-400">not on the price list</span>
                    )}
                  </td>
                  <td className="num px-6 py-3 text-right text-steel-700">
                    {formatNumber(l.grossWeight, 3)}
                  </td>
                  <td className="num px-6 py-3 text-right text-steel-700">
                    {formatNumber(l.tareWeight, 3)}
                  </td>
                  <td className="num px-6 py-3 text-right font-semibold text-steel-900">
                    {formatNumber(l.netWeight, 3)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-steel-200 font-semibold">
                <td className="px-6 py-3 text-steel-700">Total</td>
                <td className="num px-6 py-3 text-right text-steel-700">
                  {formatNumber(totalGross, 3)}
                </td>
                <td className="px-6 py-3" />
                <td className="num px-6 py-3 text-right text-steel-900">
                  {formatNumber(totalNet, 3)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="btn-row mt-4 justify-end">
        {!isVoid && (
          <button
            type="button"
            onClick={() => navigate(`/collections/${id}/edit`)}
            className="btn-secondary"
          >
            Edit
          </button>
        )}
        {isAdmin && !isVoid && (
          <button type="button" onClick={() => setDialog('void')} className="btn-danger">
            Void…
          </button>
        )}
        {isAdmin && isVoid && (
          <button
            type="button"
            onClick={() => runAction('restore')}
            disabled={busy}
            className="btn-secondary"
          >
            Restore
          </button>
        )}
      </div>

      <ConfirmDialog
        open={dialog === 'void'}
        title={`Void collection #${collection.collectionNumber}?`}
        body="It keeps its number and stays in the history, but is left out of every total."
        confirmLabel="Void it"
        tone="danger"
        reasonLabel="Why (optional)"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => runAction('void', { reason })}
      />
    </div>
  );
}

function Detail({ label, children, className = '' }) {
  return (
    <div className={className}>
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}

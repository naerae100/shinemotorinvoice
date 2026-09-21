import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../lib/apiError';
import ConfirmDialog from '../components/ConfirmDialog';
import PhotoStrip from '../components/PhotoStrip';

const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * One pickup, as recorded.
 *
 * A card per grade rather than a table, for the same reason the form is one:
 * seven figures and a row of photographs do not fit a table row, and what is
 * being read here is a comparison between two weighings — which reads as two
 * columns, not as seven cells.
 *
 * It also shows who touched it. A contractor can correct their own entry,
 * which is the right trade for a weight typed beside a truck, but only if
 * the correction is visible afterwards — so who recorded it and who last
 * changed it sit on the record rather than only in the audit trail.
 */
export default function CollectionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();

  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  // Set when the form saved but a photo did not upload. The weights are
  // safe; this says what is still outstanding — see the save in
  // NewCollectionPage, which deliberately never lets a photo fail the form.
  const [notice, setNotice] = useState(location.state?.notice ?? '');

  const load = useCallback(
    () =>
      api
        .get(`/collections/${id}`)
        .then((res) => {
          setCollection(res.data.collection);
          setError('');
        })
        .catch(() => setError('Could not load that collection.'))
        .finally(() => setLoading(false)),
    [id]
  );

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

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
  const totalNet = round3(collection.lines.reduce((a, l) => a + Number(l.netWeight), 0));

  // Only the grades weighed on both sides. Setting our whole net against a
  // supplier figure that covers half of them would report a difference which
  // is mostly the missing lines.
  const both = collection.lines.filter((l) => l.supplierNetWeight != null);
  const comparison = both.length
    ? {
        lines: both.length,
        ours: round3(both.reduce((a, l) => a + Number(l.netWeight), 0)),
        theirs: round3(both.reduce((a, l) => a + Number(l.supplierNetWeight), 0)),
      }
    : null;

  const photoCount =
    collection.photos.length + collection.lines.reduce((a, l) => a + l.photos.length, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to="/collections" className="text-sm font-medium text-copper-600">
          ← All collections
        </Link>
        <div className="btn-row">
          {!isVoid && (
            <button
              type="button"
              onClick={() => navigate(`/collections/${id}/edit`)}
              className="btn-secondary btn-sm"
            >
              Edit
            </button>
          )}
          {isAdmin && !isVoid && (
            <button type="button" onClick={() => setDialog('void')} className="btn-danger btn-sm">
              Void…
            </button>
          )}
          {isAdmin && isVoid && (
            <button
              type="button"
              onClick={() => runAction('restore')}
              disabled={busy}
              className="btn-secondary btn-sm"
            >
              Restore
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-working-amber/30 bg-working-amberDim px-4 py-3 text-sm text-working-amber">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      {/* ── Header and the three headline figures ──────────────────── */}
      <div className="surface overflow-hidden">
        <div className="flex flex-col gap-3 bg-steel-900 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-semibold text-paper">
              Collection #{collection.collectionNumber}
            </h1>
            {/* steel-300, not steel-400: on this ground the lighter grey
                measured about 2.8:1, under the 4.5:1 floor, and the date was
                genuinely hard to read. */}
            <div className="text-xs font-medium text-steel-300">
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
          <div className="border-b border-working-red/20 bg-working-redDim px-5 py-3 text-sm text-working-red sm:px-6">
            {collection.voidReason}
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-steel-100 px-5 py-4 sm:grid-cols-2 sm:px-6">
          <Field label="Collected from">
            <Link
              to={`/local-suppliers/${collection.localSupplier.id}`}
              className="font-semibold text-steel-900 hover:text-copper-600"
            >
              {collection.localSupplier.name}
            </Link>
            <div className="mt-0.5 text-xs text-steel-500">
              {[collection.localSupplier.suburb, collection.localSupplier.state]
                .filter(Boolean)
                .join(', ') || 'No address on file'}
            </div>
          </Field>
          <Field label="Recorded by">
            <div className="font-semibold text-steel-900">
              {collection.createdBy?.name ?? 'Unknown'}
            </div>
            {collection.editedBy && (
              <div className="mt-0.5 text-xs text-steel-500">
                Last edited by {collection.editedBy.name}
                {collection.editedAt &&
                  ` on ${format(new Date(collection.editedAt), 'd MMM, h:mma')}`}
              </div>
            )}
          </Field>
        </div>

        {/* The three numbers somebody opens this page to see. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 sm:divide-x sm:divide-steel-100">
          <Stat label="Collection total" value={`${formatNumber(totalNet, 3)} kg`} />
          <Stat
            label={
              comparison && comparison.lines < collection.lines.length
                ? `Theirs · ${comparison.lines} of ${collection.lines.length}`
                : 'Their total'
            }
            value={comparison ? `${formatNumber(comparison.theirs, 3)} kg` : 'not weighed'}
            muted={!comparison}
          />
          <Stat
            label="Difference"
            value={
              comparison
                ? `${comparison.ours - comparison.theirs > 0 ? '+' : ''}${formatNumber(
                    round3(comparison.ours - comparison.theirs),
                    3
                  )} kg`
                : '—'
            }
            plate={Boolean(comparison)}
            className="col-span-2 border-t border-steel-100 sm:col-span-1 sm:border-t-0"
          />
        </div>
      </div>

      {/* ── A card per grade ───────────────────────────────────────── */}
      <h2 className="section-label">What was collected</h2>
      <div className="space-y-4">
        {collection.lines.map((l) => {
          const theirs = l.supplierNetWeight == null ? null : Number(l.supplierNetWeight);
          const diff = theirs === null ? null : round3(Number(l.netWeight) - theirs);
          return (
            <div key={l.id} className="surface overflow-hidden">
              <div className="px-5 py-4">
                <div className="font-semibold text-steel-900">
                  {l.material?.description ?? l.description}
                  {!l.material && (
                    <span className="ml-2 text-xs font-normal text-steel-400">
                      not a listed grade
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-[3.5rem_1fr_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
                  <div />
                  <div className="text-center text-[11px] font-bold uppercase tracking-wider text-steel-500">
                    Ours
                  </div>
                  <div className="text-center text-[11px] font-bold uppercase tracking-wider text-steel-400">
                    Theirs
                  </div>
                  <Row label="Gross" ours={l.grossWeight} theirs={l.supplierGrossWeight} />
                  <Row label="Tare" ours={l.tareWeight} theirs={l.supplierTareWeight} />
                  <Row label="Net" ours={l.netWeight} theirs={l.supplierNetWeight} strong />
                </div>

                {(l.photos.length > 0 || !isVoid) && (
                  <div className="mt-4 border-t border-steel-100 pt-3">
                    <PhotoStrip
                      compact
                      collectionId={collection.id}
                      lineId={l.id}
                      photos={l.photos}
                      canAdd={!isVoid}
                      canDelete={isAdmin}
                      onChanged={load}
                    />
                  </div>
                )}
              </div>

              {/* The answer, on its own plate — the same treatment the form
                  gives it, so the number looks the same in both places. */}
              <div
                className={`flex items-center justify-between px-5 py-2.5 ${
                  diff === null ? 'bg-steel-100' : 'bg-steel-900'
                }`}
              >
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider ${
                    diff === null ? 'text-steel-500' : 'text-steel-300'
                  }`}
                >
                  Difference
                </span>
                {diff === null ? (
                  <span className="text-xs font-medium text-steel-500">they did not weigh</span>
                ) : (
                  <span className="num text-lg font-bold leading-none text-white">
                    {diff > 0 ? '+' : ''}
                    {formatNumber(diff, 3)}
                    <span className="ml-1 text-xs font-semibold text-steel-300">kg</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── The pickup as a whole ──────────────────────────────────── */}
      <h2 className="section-label">The pickup</h2>
      <div className="surface px-5 py-4">
        {collection.notes && (
          <div className="mb-4">
            <div className="field-label">Notes</div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-steel-700">
              {collection.notes}
            </p>
          </div>
        )}
        <div className="field-label">
          Photos
          {photoCount > 0 && (
            <span className="ml-1 font-medium text-steel-400">
              {photoCount} on this collection
            </span>
          )}
        </div>
        <PhotoStrip
          collectionId={collection.id}
          photos={collection.photos}
          canAdd={!isVoid}
          canDelete={isAdmin}
          onChanged={load}
          emptyHint="No photos."
        />
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

function Field({ label, children }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, plate = false, muted = false, className = '' }) {
  return (
    <div className={`px-5 py-4 sm:px-6 ${className}`}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-steel-500">{label}</div>
      {plate ? (
        <div className="num mt-1 inline-block rounded-md bg-steel-900 px-2.5 py-1 text-base font-bold text-white">
          {value}
        </div>
      ) : (
        <div className={`num mt-1 text-lg font-bold ${muted ? 'text-steel-400' : 'text-steel-900'}`}>
          {value}
        </div>
      )}
    </div>
  );
}

/** One weight, ours and theirs, on a single row. */
function Row({ label, ours, theirs, strong = false }) {
  const cell = (v, bold) =>
    v == null ? (
      <span className="text-steel-300">—</span>
    ) : (
      <span className={bold ? 'font-bold text-steel-900' : 'text-steel-700'}>
        {formatNumber(v, 3)}
      </span>
    );
  return (
    <>
      <div className="text-xs font-semibold text-steel-600">{label}</div>
      <div className={`num rounded-md px-2 py-1.5 text-right ${strong ? 'bg-steel-100' : ''}`}>
        {cell(ours, strong)}
      </div>
      <div className={`num rounded-md px-2 py-1.5 text-right ${strong ? 'bg-paper' : ''}`}>
        {cell(theirs, strong)}
      </div>
    </>
  );
}

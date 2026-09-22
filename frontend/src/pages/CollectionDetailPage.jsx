import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../lib/apiError';
import ConfirmDialog from '../components/ConfirmDialog';
import PhotoStrip from '../components/PhotoStrip';
import RecordHistory from '../components/RecordHistory';
import CollectionDocument from '../components/documents/CollectionDocument';
import DownloadDocument from '../components/DownloadDocument';
import { printAs } from '../lib/printDocument';
import { getSettings, getPublicBranding } from '../lib/settings';
import { subscribe, progressFor, clear } from '../lib/photoQueue';

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

  // Set when a photo failed to upload. The weights are safe; this says
  // what is still outstanding — see the queue, which deliberately never
  // lets a photo fail the form.
  const [notice, setNotice] = useState(location.state?.notice ?? '');

  /**
   * Uploads still in flight from the form.
   *
   * The form navigates the moment the collection is written and leaves the
   * photographs to a queue outside React, so this page opens while they are
   * still going up. Without this it would show an empty photo section and
   * look like they had been lost.
   */
  const [upload, setUpload] = useState(() => progressFor(id));

  // A contractor cannot read /api/settings — it is not on their allowlist —
  // but they are the person most likely to be handing a seller a printed
  // copy, and a sheet with no letterhead on it is not much of a record. So
  // fall back to the public branding: trading name, ABN, address, phone.
  // No logo, because that endpoint deliberately does not carry one.
  const [settings, setSettings] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(() => getPublicBranding().then(setSettings));
  }, []);

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

  useEffect(() => {
    let last = progressFor(id);
    setUpload(last);
    return subscribe(() => {
      const now = progressFor(id);
      // `last` is advanced BEFORE anything below runs, and this is not a
      // tidiness point. clear() emits, and emitting from inside a listener
      // re-enters this function synchronously — with the old `last` still in
      // place, so the same two branches fired again, and again. Measured at
      // 3,800 GETs of one collection in nine seconds before the browser
      // started refusing connections.
      const prev = last;
      last = now;

      setUpload(now);
      // Refresh as each one lands, so photographs appear as they arrive
      // rather than all at once when the batch ends.
      if (now.done !== prev.done) load();
      if (!now.running && prev.running) {
        if (now.failed) {
          setNotice(
            `${now.failed} ${now.failed === 1 ? 'photo' : 'photos'} did not upload. Open Edit to add ${now.failed === 1 ? 'it' : 'them'} again.`
          );
        }
        clear(id);
      }
    });
  }, [id, load]);

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

  const docName = `Collection-${collection.collectionNumber}_${collection.localSupplier.name}`;

  const pickupPhotos = collection.photos.length;
  const gradePhotos = collection.lines.reduce((a, l) => a + l.photos.length, 0);

  /**
   * Whether this page offers to add a photo.
   *
   * It did, always, which meant a pickup with no photographs still showed a
   * camera tile — so the section looked like it held something when it held
   * nothing, and the page stopped being a record and became a half-form.
   * Adding belongs in Edit. The exception is a photo that failed to upload
   * on save: that is the one case where the record is right and the photos
   * are not, and sending somebody to Edit to fix it would be obtuse.
   */
  const canAddHere = Boolean(notice) && !isVoid;

  /**
   * Hand the seller a link rather than a file.
   *
   * A PDF in an email is a copy: correct a weight tomorrow and they are
   * holding yesterday's numbers with no way to know it. The link points at
   * the record.
   *
   * On a phone this opens the share sheet, so it goes straight into whatever
   * they message people with. Everywhere else it lands on the clipboard —
   * and if the clipboard is blocked, which it is on an insecure origin, the
   * URL is shown so it can still be copied by hand.
   */
  async function share() {
    setSharing(true);
    try {
      const { data } = await api.post(`/collections/${id}/share`);
      // Show the URL input straight away, before the share sheet opens.
      // If somebody dismisses the sheet (AbortError) the link is still
      // visible so they can copy it by hand.
      setShareUrl(data.url);
      const text = `Field collection #${collection.collectionNumber} — ${collection.localSupplier.name}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: text, url: data.url });
        } catch (shareErr) {
          // AbortError is just the person closing the share sheet.
          if (shareErr?.name !== 'AbortError') throw shareErr;
        }
      } else {
        try {
          await navigator.clipboard.writeText(data.url);
          setShared('copied');
          setTimeout(() => setShared(''), 4000);
        } catch {
          // Clipboard blocked (insecure origin). The URL input is already
          // showing, so they can select and copy from there.
        }
      }
    } catch (err) {
      setError('Could not make a share link.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 print:max-w-none print:p-0 sm:px-6 lg:px-8 lg:py-7">
      <div className="print:hidden">
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
          {!isVoid && (
            <button type="button" onClick={share} disabled={sharing} className="btn-secondary btn-sm">
              {sharing ? 'Making link…' : shared === 'copied' ? 'Link copied' : 'Share'}
            </button>
          )}
          <button
            type="button"
            onClick={() => printAs(docName)}
            className="btn-secondary btn-sm"
          >
            Print
          </button>
          <DownloadDocument filename={docName} className="btn-secondary btn-sm" />
        </div>
      </div>

      {shareUrl && (
        <div className="mb-4 rounded-lg border border-steel-200 bg-white px-4 py-3 print:hidden">
          <div className="field-label">Share link · opens without a login, expires in 90 days</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-md border border-steel-200 bg-paper px-3 py-2 text-xs text-steel-700"
            />
            <a href={shareUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
              Open
            </a>
          </div>
        </div>
      )}

      {upload.running && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-steel-200 bg-white px-4 py-3 text-sm text-steel-600">
          <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-copper-500" />
          <span>
            Uploading photos — {upload.done} of {upload.total} done. You can leave this page.
          </span>
        </div>
      )}

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

                {l.notes && (
                  <p className="mt-3 border-t border-steel-100 pt-3 text-sm leading-relaxed text-steel-700">
                    {l.notes}
                  </p>
                )}

                {(l.photos.length > 0 || canAddHere) && (
                  <div className="mt-3 border-t border-steel-100 pt-3">
                    <PhotoStrip
                      compact
                      collectionId={collection.id}
                      lineId={l.id}
                      photos={l.photos}
                      canAdd={canAddHere}
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
      {/* Gone entirely when there is nothing in it. A heading over the words
          "No photos of the pickup itself" is a section whose only content is
          an apology for having none. */}
      {(collection.notes || pickupPhotos > 0 || canAddHere) && (
        <>
          <h2 className="section-label">The pickup</h2>
          <div className="surface px-5 py-4">
            {collection.notes && (
              <div className={pickupPhotos > 0 || canAddHere ? 'mb-4' : ''}>
                <div className="field-label">Notes</div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-steel-700">
                  {collection.notes}
                </p>
              </div>
            )}
            {(pickupPhotos > 0 || canAddHere) && (
              <>
                <div className="field-label">Photos of the pickup</div>
                <PhotoStrip
                  collectionId={collection.id}
                  photos={collection.photos}
                  canAdd={canAddHere}
                  canDelete={isAdmin}
                  onChanged={load}
                />
              </>
            )}
          </div>
        </>
      )}

      {/* Admin only, like the trail behind it. "Last edited by X" above
          answers who; this answers what, which is the question that makes
          letting a contractor correct their own weights safe rather than
          merely convenient. */}
      {isAdmin && (
        <>
          <h2 className="section-label">History</h2>
          <div className="surface px-5 py-4">
            <RecordHistory entity="Collection" entityId={collection.id} />
          </div>
        </>
      )}

      </div>

      {/* The printable sheet. Hidden on screen and the only thing printed —
          the page above it is a working view with buttons and a history, and
          none of that belongs on something handed to a seller. */}
      <div className="hidden print:block">
        <CollectionDocument collection={collection} settings={settings} />
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

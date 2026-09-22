import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { api } from '../lib/api';

/**
 * What has happened to one record, and who did it.
 *
 * The page already said "Last edited by X". That answers who, and leaves the
 * question an admin actually has — what did they change? A contractor can
 * correct their own weights, which is the right trade for a number typed
 * beside a truck, but it is only an acceptable one if the change is legible
 * afterwards. Otherwise "edited" is indistinguishable from "quietly made the
 * discrepancy go away".
 *
 * The trail is admin-only at the API, so this is too.
 */

const ACTION_LABEL = {
  CREATE: 'Recorded',
  UPDATE: 'Edited',
  VOID: 'Voided',
  RESTORE: 'Restored',
};

/** Turn a stored field name into something a person would say. */
const FIELD_LABEL = {
  localSupplier: 'Collected from',
  notes: 'Notes',
  gradeNotes: 'Note on a grade',
  weights: 'Weights',
  photoAdded: 'Photo added',
  photo: 'Photo removed',
  reason: 'Reason',
  lines: 'Grades',
};

export default function RecordHistory({ entity, entityId }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api
      .get('/audit', { params: { entity, entityId, pageSize: 50 } })
      .then((res) => setEvents(res.data.events))
      .catch(() => setError('Could not load the history.'));
  }, [entity, entityId]);

  if (error) return <p className="text-xs text-steel-400">{error}</p>;
  if (!events) return <p className="text-xs text-steel-400">Loading history…</p>;
  if (events.length === 0) return <p className="text-xs text-steel-400">Nothing recorded yet.</p>;

  // The create is always the last event and says nothing an admin is
  // hunting for, so the collapsed view shows the changes since.
  const shown = open ? events : events.slice(0, 3);

  return (
    <div>
      <ol className="space-y-3">
        {shown.map((e) => {
          const who = e.actor?.name || e.actorEmail || 'Unknown';
          const changed = fieldsChanged(e);
          return (
            <li key={e.id} className="border-l-2 border-steel-200 pl-3">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-semibold text-steel-900">
                  {ACTION_LABEL[e.action] ?? e.action}
                </span>
                <span className="text-steel-600">by {who}</span>
                <span className="text-xs text-steel-400">
                  {format(new Date(e.at), 'd MMM yyyy, h:mma')}
                </span>
              </div>

              {changed.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {changed.map((c) => (
                    <li key={c.field} className="text-xs leading-relaxed">
                      <span className="font-semibold text-steel-600">
                        {FIELD_LABEL[c.field] ?? c.field}
                      </span>{' '}
                      {c.from !== undefined && (
                        <>
                          <span className="text-steel-400 line-through">{c.from || '—'}</span>{' '}
                          <span className="text-steel-400">→</span>{' '}
                        </>
                      )}
                      <span className="text-steel-800">{c.to || '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {events.length > 3 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 text-xs font-semibold text-copper-600 hover:text-copper-700"
        >
          {open ? 'Show less' : `Show all ${events.length} entries`}
        </button>
      )}
    </div>
  );
}

/**
 * The fields an event actually touched.
 *
 * An UPDATE stores only what changed, before and after — not the whole row,
 * which would make the trail larger than the data it describes. A CREATE
 * stores just enough to say what was made.
 */
function fieldsChanged(e) {
  const before = e.before ?? {};
  const after = e.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.map((field) => ({
    field,
    from: field in before ? String(before[field] ?? '') : undefined,
    to: String(after[field] ?? ''),
  }));
}

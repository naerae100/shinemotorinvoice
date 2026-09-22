import { api } from './api';

/**
 * Photograph uploads that outlive the screen that started them.
 *
 * Saving a collection used to mean: write the record, then wait while every
 * photo went up one after another, then move on. On a yard's signal with
 * four grades photographed that is ten or fifteen seconds of somebody
 * standing beside a truck looking at a spinner — and the collection was
 * already saved a moment into it. They were waiting on the attachments, not
 * the record.
 *
 * So the queue lives here, outside React, in module scope. The form hands it
 * the files and navigates immediately; uploads carry on regardless of which
 * screen is mounted, and the detail page subscribes to watch them land.
 *
 * Three at a time. One is needlessly slow on a decent connection; all of
 * them at once makes a phone's radio thrash and, on a bad connection, means
 * every upload times out together instead of three succeeding.
 */
const CONCURRENCY = 3;

/** collectionId -> { total, done, failed, running } */
const state = new Map();
const listeners = new Set();

const snapshot = (collectionId) =>
  state.get(collectionId) ?? { total: 0, done: 0, failed: 0, running: false };

/**
 * Advance one counter.
 *
 * Read-modify-write, done as one step. Three workers run at once and two
 * finishing together both read done=0 and both wrote done=1 — a lost
 * update, so the progress line would stall a photo short of the total and
 * the batch would look stuck when it had finished.
 */
function bump(collectionId, field) {
  const s = snapshot(collectionId);
  state.set(collectionId, { ...s, [field]: s[field] + 1 });
}

function emit() {
  // Over a copy. A listener is allowed to subscribe, unsubscribe or — as
  // clear() does — emit again, and iterating the live Set while that happens
  // is how a re-entrant emit turns into a loop nobody can see in the code.
  for (const fn of [...listeners]) fn();
}

/** Subscribe to progress. Returns an unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const progressFor = (collectionId) => snapshot(collectionId);

/** Forget a finished batch, so a later visit does not show a stale banner. */
export function clear(collectionId) {
  state.delete(collectionId);
  emit();
}

/**
 * @param collectionId the saved collection
 * @param items [{ file, lineId }] — lineId null for a photo of the pickup
 * @param onSettled called once when the batch finishes, with { done, failed }
 */
export function enqueue(collectionId, items, onSettled) {
  if (!items.length) return;

  const current = snapshot(collectionId);
  state.set(collectionId, {
    total: current.total + items.length,
    done: current.done,
    failed: current.failed,
    running: true,
  });
  emit();

  const pending = [...items];

  const worker = async () => {
    for (;;) {
      const next = pending.shift();
      if (!next) return;
      let outcome = 'done';
      try {
        const form = new FormData();
        form.append('photo', next.file);
        if (next.lineId) form.append('lineId', next.lineId);
        await api.post(`/collections/${collectionId}/photos`, form);
      } catch {
        outcome = 'failed';
      }
      bump(collectionId, outcome);
      emit();
    }
  };

  Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker)).then(() => {
    const s = snapshot(collectionId);
    state.set(collectionId, { ...s, running: false });
    emit();
    onSettled?.({ done: s.done, failed: s.failed });
  });
}

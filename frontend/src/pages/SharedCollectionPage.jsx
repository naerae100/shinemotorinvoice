import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import CollectionDocument from '../components/documents/CollectionDocument';
import { getPublicBranding } from '../lib/settings';
import { collectionRef } from '../lib/collectionRef';

/**
 * The page a seller opens from a link, with no account.
 *
 * Outside the app shell on purpose: no sidebar, no navigation, nothing that
 * offers to take them somewhere they cannot go. It is one document and two
 * things to do with it.
 *
 * It calls the API directly rather than through lib/api, because that client
 * attaches a bearer token and redirects to the login screen on a 401 — both
 * exactly wrong here. The token in the URL is the whole credential.
 */
const API = import.meta.env.VITE_API_URL || '/api';

export default function SharedCollectionPage() {
  const { token } = useParams();
  const [collection, setCollection] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios
      .get(`${API}/collections/shared/${token}`)
      .then((res) => {
        setCollection(res.data.collection);
        // The endpoint sends the letterhead with the record, logo included,
        // so the sheet a seller opens is branded rather than bare.
        if (res.data.branding) setSettings(res.data.branding);
      })
      .catch((err) =>
        setError(
          err.response?.status === 410
            ? 'This collection has been cancelled. Please contact us for the current record.'
            : 'This link is not valid, or it has expired. Please ask for a new one.'
        )
      );
    // A fallback only, for the moment before the record lands.
    getPublicBranding().then((b) => setSettings((prev) => prev ?? b));
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-6">
        <div className="max-w-md text-center">
          <div className="font-display text-xl font-semibold text-steel-900">
            Nothing to show here
          </div>
          <p className="mt-2 text-sm leading-relaxed text-steel-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="text-sm text-steel-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-steel-100 print:bg-white">
      {/* The bar is not part of the document, so it does not print. */}
      <div className="pad-safe-top print:hidden">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-steel-500">
              Field collection
            </div>
            <div className="truncate font-display text-lg font-semibold text-steel-900">
              {collectionRef(collection.collectionNumber)} · {collection.localSupplier.name}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[900px] px-4 pb-10 sm:px-6 print:max-w-none print:px-0 print:pb-0">
        <div className="overflow-hidden rounded-xl shadow-ticket print:rounded-none print:shadow-none">
          <CollectionDocument collection={collection} settings={settings} />
        </div>
      </div>
    </div>
  );
}

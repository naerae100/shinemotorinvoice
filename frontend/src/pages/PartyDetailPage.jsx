import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { addressLines, addressOneLine, formatAud, formatMoney, formatNumber } from '../lib/format';
import DateRangePicker, { PRESETS } from '../components/DateRangePicker';
import BarList from '../components/charts/BarList';
import StatTile from '../components/charts/StatTile';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import { SERIES } from '../components/charts/palette';

function Card({ title, action, children }) {
  return (
    <div className="rounded-xl border border-steel-200 bg-white shadow-ticket">
      <div className="flex items-center justify-between border-b border-steel-100 px-5 py-3.5">
        <h2 className="font-display text-base font-semibold text-steel-900">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'total-desc', label: 'Highest value' },
  { value: 'total-asc', label: 'Lowest value' },
  { value: 'ref-asc', label: 'Reference A→Z' },
];

/**
 * One party's complete history — what they trade, how much, and when. `kind`
 * switches between a supplier (who sells scrap to us) and a consignee (who buys
 * from us); the two are separate records by design, so this renders whichever.
 */
export default function PartyDetailPage({ kind }) {
  const { id } = useParams();
  const isSupplier = kind === 'supplier';

  const initial = PRESETS.thisFinancialYear();
  const [range, setRange] = useState({ from: initial.from, to: initial.to, granularity: 'month' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // Documents section — search, sort, type filter
  const [docSearch, setDocSearch] = useState('');
  const [docSort, setDocSort] = useState('date-desc');
  const [docType, setDocType] = useState('ALL');

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/reports/${kind}/${id}`, { params: { from: range.from, to: range.to } })
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setError('Could not load this client.'));
    return () => {
      cancelled = true;
    };
  }, [kind, id, range.from, range.to]);

  // Merge invoices + packing slips into one unified list for the documents table.
  const allDocs = useMemo(() => {
    if (!data) return [];
    if (isSupplier) {
      const dockets = (data.dockets ?? []).map((d) => ({
        id: d.id,
        ref: `#${d.docketNumber}`,
        type: d.type === 'TAX_INVOICE' ? 'Tax invoice' : 'Purchase docket',
        typeBadge: d.type === 'TAX_INVOICE' ? 'bg-brand-100 text-brand-700' : 'bg-steel-100 text-steel-600',
        container: null,
        date: d.date,
        total: d.total,
        currency: 'AUD',
        status: d.status,
        path: `${d.type === 'TAX_INVOICE' ? '/tax-invoices' : '/purchases'}/${d.id}`,
        editPath: `${d.type === 'TAX_INVOICE' ? '/tax-invoices' : '/purchases'}/${d.id}/edit`,
      }));
      return dockets;
    }
    const invoices = (data.invoices ?? []).map((inv) => ({
      id: inv.id,
      ref: inv.invoiceNumber,
      type: 'Invoice',
      typeBadge: 'bg-brand-100 text-brand-700',
      container: (inv.containers ?? []).map((c) => c.containerNo).filter(Boolean).join(', ') || null,
      date: inv.date,
      total: inv.total,
      currency: inv.currency || 'AUD',
      status: inv.status,
      stage: inv.stage || 'INVOICED',
      path: `/export-invoices/${inv.id}`,
      editPath: `/export-invoices/${inv.id}/edit`,
    }));
    const slips = (data.slips ?? []).map((s) => ({
      id: s.id,
      ref: s.invoiceNumber,
      type: 'Packing slip',
      typeBadge: 'bg-working-amberDim text-working-amber',
      container: null,
      date: s.date,
      total: null,
      currency: null,
      netWeightMt: s.netWeightMt,
      status: 'ACTIVE',
      stage: 'PACKING_SLIP',
      path: `/packing-slips/${s.id}`,
      editPath: `/packing-slips/${s.id}/edit`,
    }));
    return [...invoices, ...slips];
  }, [data, isSupplier]);

  // Filtered + sorted docs
  const filteredDocs = useMemo(() => {
    let list = allDocs;

    // Type filter
    if (docType !== 'ALL') {
      list = list.filter((d) => d.type === docType);
    }

    // Search
    if (docSearch.trim()) {
      const q = docSearch.trim().toLowerCase();
      list = list.filter(
        (d) =>
          d.ref?.toLowerCase().includes(q) ||
          d.container?.toLowerCase().includes(q) ||
          d.type.toLowerCase().includes(q)
      );
    }

    // Sort
    const [field, dir] = docSort.split('-');
    list = [...list].sort((a, b) => {
      if (field === 'date') {
        const diff = new Date(a.date) - new Date(b.date);
        return dir === 'asc' ? diff : -diff;
      }
      if (field === 'total') {
        const diff = (a.total ?? 0) - (b.total ?? 0);
        return dir === 'asc' ? diff : -diff;
      }
      if (field === 'ref') {
        return dir === 'asc' ? (a.ref ?? '').localeCompare(b.ref ?? '') : (b.ref ?? '').localeCompare(a.ref ?? '');
      }
      return 0;
    });

    return list;
  }, [allDocs, docSearch, docSort, docType]);

  // Unique document types for filter dropdown
  const docTypes = useMemo(() => {
    const types = [...new Set(allDocs.map((d) => d.type))];
    return types.sort();
  }, [allDocs]);

  if (error) return <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 text-sm text-working-red">{error}</div>;
  if (!data) return <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 text-sm text-steel-500">Loading…</div>;

  const party = isSupplier ? data.supplier : data.consignee;
  const color = isSupplier ? SERIES.purchases : SERIES.sales;
  const listPath = isSupplier ? '/clients' : '/buyers';
  const unit = isSupplier ? 'kg' : 'MT';

  // The party series carries one key; the shared chart expects both.
  const series = data.series.map((p) => ({
    period: p.period,
    purchases: isSupplier ? p.purchases : 0,
    purchasesCount: isSupplier ? p.purchasesCount : 0,
    sales: isSupplier ? 0 : p.sales,
    salesCount: isSupplier ? 0 : p.salesCount,
  }));

  // Build subtitle from structured address
  const subtitle = isSupplier
    ? [
        party.saleType === 'BUSINESS' ? 'Business' : 'Private',
        addressOneLine(party),
        party.phone,
        party.email,
        party.abn && `ABN ${party.abn}`,
        party.licenceNo && `Licence ${party.licenceNo}`,
      ]
        .filter(Boolean)
        .join('  ·  ')
    : [addressOneLine(party), party.phone, party.email]
        .filter(Boolean)
        .join('  ·  ');

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <Link to={listPath} className="text-sm text-steel-500 hover:text-copper-600">
        ← {isSupplier ? 'Clients' : 'Buyers'}
      </Link>
      <div className="mb-5 mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-steel-900">{party.name}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-steel-500">{subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to={listPath}
            state={{ editId: party.id }}
            className="rounded-md border border-steel-300 bg-white px-4 py-2.5 text-sm font-semibold text-steel-700 hover:bg-paper"
          >
            Edit
          </Link>
          <Link
            to={isSupplier ? `/purchases?supplierId=${party.id}` : `/export-invoices?consigneeId=${party.id}`}
            className="rounded-md border border-steel-300 bg-white px-4 py-2.5 text-sm font-semibold text-steel-700 hover:bg-paper"
          >
            All documents →
          </Link>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-steel-200 bg-white p-3 shadow-ticket">
        <DateRangePicker {...range} showGranularity={false} onChange={setRange} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={isSupplier ? 'Bought in period' : 'Sold in period'}
          value={formatAud(data.inRange.total)}
          sub={`${data.inRange.count} ${data.inRange.count === 1 ? 'document' : 'documents'}`}
          accent={!isSupplier}
        />
        <StatTile label="GST in period" value={formatAud(data.inRange.gst)} />
        <StatTile
          label="Lifetime total"
          value={formatAud(data.lifetime.total)}
          sub={`${data.lifetime.count} documents all time`}
        />
        <StatTile
          label="Average document"
          value={formatAud(data.inRange.count ? data.inRange.total / data.inRange.count : 0)}
          sub={
            data.lifetime.firstDealt
              ? `First dealt ${format(new Date(data.lifetime.firstDealt), 'MMM yyyy')}`
              : 'In the selected period'
          }
        />
      </div>

      <div className="mb-6">
        <Card title={isSupplier ? 'What we buy from them, over time' : 'What we sell them, over time'}>
          <TimeSeriesChart data={series} granularity="month" />
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={isSupplier ? 'Materials they bring in' : 'Materials they buy'}>
          <BarList
            items={data.materials.map((m) => ({
              key: m.material.id,
              label: m.material.description,
              value: m.value,
              sub: `${formatNumber(m.weight, 3)} ${unit} across ${m.lines} ${m.lines === 1 ? 'line' : 'lines'}`,
            }))}
            color={color}
            emptyLabel="Nothing in this period."
          />
        </Card>

        {!isSupplier && (
          <Card title="Contracts">
            {(data.contracts ?? []).length === 0 ? (
              <div className="py-8 text-center text-sm text-steel-500">
                Nothing recorded yet.
              </div>
            ) : (
              <div className="max-h-[420px] space-y-3 overflow-auto">
                {/* One contract routinely covers two or three shipments, so the
                    contract is the heading and its shipments sit under it —
                    which is how the buyer refers to them. */}
                {data.contracts.map((c) => (
                  <div
                    key={c.contractNo ?? 'none'}
                    className="rounded-lg border border-steel-200 bg-paper/50 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="num text-sm font-semibold text-steel-900">
                        {c.contractNo ?? (
                          <span className="font-sans italic text-steel-400">No contract number</span>
                        )}
                      </div>
                      <div className="num text-sm font-semibold text-steel-900">
                        {Object.keys(c.totals).length === 0
                          ? '—'
                          : Object.entries(c.totals)
                              .map(([cur, amt]) => formatMoney(amt, cur))
                              .join('  ·  ')}
                      </div>
                    </div>
                    <div className="mt-0.5 text-xs text-steel-500">
                      {c.shipments.length} {c.shipments.length === 1 ? 'shipment' : 'shipments'}
                      {c.slipCount > 0 && ` · ${c.slipCount} not yet priced`} ·{' '}
                      <span className="num">{formatNumber(c.netWeightMt, 3)}</span> MT
                    </div>
                    <div className="mt-2 space-y-1">
                      {c.shipments.map((sh) => (
                        <div key={sh.id} className="flex items-baseline justify-between gap-2 text-xs">
                          <Link
                            to={`${sh.stage === 'PACKING_SLIP' ? '/packing-slips' : '/export-invoices'}/${sh.id}`}
                            className="num font-medium text-steel-700 hover:text-copper-600"
                          >
                            {sh.invoiceNumber}
                          </Link>
                          <span className="text-steel-400">
                            {format(new Date(sh.date), 'd MMM yyyy')}
                          </span>
                          <span className="num flex-1 text-right text-steel-600">
                            {sh.stage === 'PACKING_SLIP' ? (
                              <span className="font-sans text-working-amber">Packing slip</span>
                            ) : (
                              formatMoney(sh.total, sh.currency || 'AUD')
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ── Full documents table with search and sort ──────────────── */}
      <div className="rounded-xl border border-steel-200 bg-white shadow-ticket">
        <div className="flex flex-col gap-3 border-b border-steel-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-base font-semibold text-steel-900">
            All documents
            <span className="ml-2 text-sm font-normal text-steel-400">
              {filteredDocs.length} of {allDocs.length}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search ref, container…"
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              className="w-48 rounded-md border border-steel-200 bg-white px-3 py-1.5 text-sm focus:border-copper-500"
            />
            {docTypes.length > 1 && (
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="rounded-md border border-steel-200 bg-white px-3 py-1.5 text-sm focus:border-copper-500"
              >
                <option value="ALL">All types</option>
                {docTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            <select
              value={docSort}
              onChange={(e) => setDocSort(e.target.value)}
              className="rounded-md border border-steel-200 bg-white px-3 py-1.5 text-sm focus:border-copper-500"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[580px] text-sm">
            <thead>
              <tr className="border-b border-steel-100 bg-paper text-left text-xs uppercase tracking-wider text-steel-500">
                <th className="px-5 py-2.5 font-medium">Reference</th>
                <th className="px-5 py-2.5 font-medium">Type</th>
                {!isSupplier && <th className="px-5 py-2.5 font-medium">Container</th>}
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 text-right font-medium">Total</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.length === 0 && (
                <tr>
                  <td colSpan={isSupplier ? 5 : 6} className="px-5 py-10 text-center text-steel-500">
                    {docSearch ? 'No documents match your search.' : 'No documents yet.'}
                  </td>
                </tr>
              )}
              {filteredDocs.map((doc) => {
                const isVoid = doc.status === 'VOID';
                return (
                  <tr
                    key={doc.id}
                    className={`border-b border-steel-100 last:border-0 hover:bg-paper ${isVoid ? 'opacity-50' : ''}`}
                  >
                    <td className="px-5 py-3">
                      <Link
                        to={doc.path}
                        className={`num font-medium text-steel-900 hover:text-copper-600 ${isVoid ? 'line-through' : ''}`}
                      >
                        {doc.ref}
                      </Link>
                      {isVoid && (
                        <span className="ml-2 rounded bg-working-redDim px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-working-red">
                          Void
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${doc.typeBadge}`}>
                        {doc.type}
                      </span>
                    </td>
                    {!isSupplier && (
                      <td className="num px-5 py-3 text-steel-500">
                        {doc.container || '—'}
                      </td>
                    )}
                    <td className="px-5 py-3 text-steel-500">
                      {format(new Date(doc.date), 'd MMM yyyy')}
                    </td>
                    <td className="num px-5 py-3 text-right font-medium text-steel-900">
                      {doc.total != null
                        ? formatMoney(doc.total, doc.currency || 'AUD')
                        : doc.netWeightMt != null
                          ? `${formatNumber(doc.netWeightMt, 3)} MT`
                          : '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={doc.path}
                          className="rounded-md border border-steel-200 bg-white px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper"
                        >
                          View
                        </Link>
                        {!isVoid && (
                          <Link
                            to={doc.editPath}
                            className="rounded-md border border-steel-200 bg-white px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper"
                          >
                            Edit
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

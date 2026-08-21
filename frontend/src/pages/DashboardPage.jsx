import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatAud } from '../lib/format';
import DateRangePicker, { PRESETS } from '../components/DateRangePicker';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import BarList, { materialItem, clientItem } from '../components/charts/BarList';
import StatTile from '../components/charts/StatTile';
import { SERIES } from '../components/charts/palette';

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`rounded-xl border border-steel-200 bg-white shadow-ticket ${className}`}>
      <div className="flex items-center justify-between border-b border-steel-100 px-5 py-3.5">
        <h2 className="font-display text-base font-semibold text-steel-900">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const initial = PRESETS.thisMonth();
  const [range, setRange] = useState({
    from: initial.from,
    to: initial.to,
    granularity: 'day',
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/reports/overview', { params: range })
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setError('');
      })
      .catch(() => !cancelled && setError('Could not load dashboard data.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, range.granularity]);

  const net = data?.grossMargin ?? 0;

  const recent = useMemo(() => {
    if (!data) return [];
    return [
      ...data.recentDockets.map((d) => ({
        id: d.id,
        kind: 'purchase',
        ref: `#${d.docketNumber}`,
        party: d.supplier?.name,
        date: d.date,
        total: d.total,
        to: `${d.type === 'TAX_INVOICE' ? '/tax-invoices' : '/purchases'}/${d.id}`,
      })),
      ...data.recentInvoices.map((i) => ({
        id: i.id,
        kind: 'sale',
        ref: i.invoiceNumber,
        party: i.consignee?.name,
        date: i.date,
        total: i.totalAud,
        to: `/export-invoices/${i.id}`,
      })),
    ]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">Dashboard</h1>
          <p className="mt-0.5 text-sm text-steel-500">
            {format(new Date(), 'EEEE d MMMM yyyy')}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/purchases/new"
            className="rounded-md bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 shadow-sm hover:bg-copper-400"
          >
            + New purchase
          </Link>
          <Link
            to="/tax-invoices/new"
            className="rounded-md bg-copper-200 px-4 py-2.5 text-sm font-semibold text-steel-900 shadow-sm hover:bg-copper-300"
          >
            + New tax invoice
          </Link>
          <Link
            to="/export-invoices/new"
            className="rounded-md border border-steel-300 bg-white px-4 py-2.5 text-sm font-semibold text-steel-700 hover:bg-paper"
          >
            + New export invoice
          </Link>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-steel-200 bg-white p-3 shadow-ticket">
        <DateRangePicker {...range} onChange={setRange} />
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}
      {loading && !data && <div className="text-sm text-steel-500">Loading…</div>}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Scrap bought"
              value={formatAud(data.purchases.total)}
              sub={`${data.purchases.count} ${data.purchases.count === 1 ? 'docket' : 'dockets'}`}
            />
            <StatTile
              label="Scrap sold"
              value={formatAud(data.sales.total)}
              sub={`${data.sales.count} ${data.sales.count === 1 ? 'invoice' : 'invoices'}`}
              accent
            />
            <StatTile
              label="Net movement"
              value={formatAud(net)}
              sub="Sales less purchases, this period"
              tone={net >= 0 ? 'positive' : 'negative'}
            />
            <StatTile
              label={data.sales.gst - data.purchases.gst >= 0 ? 'GST payable' : 'GST refundable'}
              value={formatAud(Math.abs(data.sales.gst - data.purchases.gst))}
              sub={`${formatAud(data.sales.gst)} collected · ${formatAud(data.purchases.gst)} paid`}
            />
          </div>

          <div className="mb-6">
            <Card
              title="Buying and selling over time"
              action={
                <span className="text-xs text-steel-400">
                  {format(new Date(range.from), 'd MMM')} – {format(new Date(range.to), 'd MMM yyyy')}
                </span>
              }
            >
              <TimeSeriesChart data={data.series} granularity={range.granularity} />
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Most bought materials">
              <BarList
                items={data.topMaterialsBought.map((m) => materialItem(m, 'kg'))}
                color={SERIES.purchases}
                emptyLabel="Nothing bought in this period."
              />
            </Card>
            <Card title="Most sold materials">
              <BarList
                items={data.topMaterialsSold.map((m) => materialItem(m, 'MT'))}
                color={SERIES.sales}
                emptyLabel="Nothing sold in this period."
              />
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card
              title="Top suppliers"
              action={
                <Link to="/clients" className="text-sm font-medium text-copper-600 hover:text-copper-700">
                  All clients →
                </Link>
              }
            >
              <BarList
                items={data.topSuppliers.map(clientItem)}
                color={SERIES.purchases}
                emptyLabel="No suppliers in this period."
              />
            </Card>
            <Card
              title="Top buyers"
              action={
                <Link to="/buyers" className="text-sm font-medium text-copper-600 hover:text-copper-700">
                  All buyers →
                </Link>
              }
            >
              <BarList
                items={data.topConsignees.map(clientItem)}
                color={SERIES.sales}
                emptyLabel="No buyers in this period."
              />
            </Card>
          </div>

          <Card
            title="Recent activity"
            action={
              <Link to="/purchases" className="text-sm font-medium text-copper-600 hover:text-copper-700">
                View all →
              </Link>
            }
          >
            {recent.length === 0 ? (
              <div className="py-8 text-center text-sm text-steel-500">Nothing recorded yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-steel-100 text-left text-xs uppercase tracking-wider text-steel-500">
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">Reference</th>
                    <th className="py-2 font-medium">Client</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.kind + r.id} className="border-b border-steel-100 last:border-0">
                      <td className="py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-sm"
                            style={{
                              background: r.kind === 'sale' ? SERIES.sales : SERIES.purchases,
                            }}
                            aria-hidden="true"
                          />
                          <span className="text-steel-600">
                            {r.kind === 'sale' ? 'Sale' : 'Purchase'}
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5">
                        <Link to={r.to} className="num font-medium text-steel-900 hover:text-copper-600">
                          {r.ref}
                        </Link>
                      </td>
                      <td className="py-2.5 text-steel-700">{r.party}</td>
                      <td className="py-2.5 text-steel-500">{format(new Date(r.date), 'd MMM')}</td>
                      <td className="num py-2.5 text-right font-medium text-steel-900">
                        {formatAud(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

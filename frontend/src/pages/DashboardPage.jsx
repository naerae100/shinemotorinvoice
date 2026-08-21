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

function Card({ title, subtitle, action, children, className = '' }) {
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-xl border border-steel-200 bg-white shadow-ticket ${className}`}
    >
      <header className="flex items-start justify-between gap-4 border-b border-steel-100 px-5 py-3.5">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-steel-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-steel-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="flex-1 px-5 py-4">{children}</div>
    </section>
  );
}

function EmptyState({ children, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <p className="text-sm text-steel-500">{children}</p>
      {action}
    </div>
  );
}

export default function DashboardPage() {
  const initial = PRESETS.thisMonth();
  const [range, setRange] = useState({ from: initial.from, to: initial.to, granularity: 'day' });
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

  const prev = data?.previous;
  const net = data?.grossMargin ?? 0;

  // Sparklines read straight off the series, so they follow the chosen filter
  // rather than showing a fixed window.
  const sparks = useMemo(() => {
    if (!data) return { purchases: [], sales: [] };
    return {
      purchases: data.series.map((d) => d.purchases),
      sales: data.series.map((d) => d.sales),
    };
  }, [data]);

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
      .slice(0, 7);
  }, [data]);

  const rangeLabel = data
    ? `${format(new Date(range.from), 'd MMM')} – ${format(new Date(range.to), 'd MMM yyyy')}`
    : '';

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight text-steel-900">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-steel-500">
            {rangeLabel || format(new Date(), 'EEEE d MMMM yyyy')}
            {prev && (
              <span className="text-steel-400">
                {' · '}compared with {format(new Date(prev.from), 'd MMM')} –{' '}
                {format(new Date(prev.to), 'd MMM')}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/purchases/new"
            className="rounded-lg bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 shadow-sm transition-colors hover:bg-copper-400"
          >
            + New purchase
          </Link>
          <Link
            to="/export-invoices/new"
            className="rounded-lg border border-steel-300 bg-white px-4 py-2.5 text-sm font-semibold text-steel-700 transition-colors hover:bg-paper"
          >
            + New invoice
          </Link>
        </div>
      </header>

      <div className="mb-6 rounded-xl border border-steel-200 bg-white p-3 shadow-ticket">
        <DateRangePicker {...range} onChange={setRange} />
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[132px] animate-pulse rounded-xl border border-steel-200 bg-white" />
          ))}
        </div>
      )}

      {data && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Scrap bought"
              value={formatAud(data.purchases.total)}
              sub={`${data.purchases.count} ${data.purchases.count === 1 ? 'docket' : 'dockets'}`}
              current={data.purchases.total}
              previous={prev?.purchases.total}
              spark={sparks.purchases}
              sparkColor={SERIES.purchases}
              to={`/purchases?from=${range.from}&to=${range.to}`}
              linkLabel="See these purchases"
            />
            <StatTile
              label="Scrap sold"
              value={formatAud(data.sales.total)}
              sub={`${data.sales.count} ${data.sales.count === 1 ? 'invoice' : 'invoices'}`}
              accent
              current={data.sales.total}
              previous={prev?.sales.total}
              spark={sparks.sales}
              sparkColor={SERIES.sales}
              to={`/export-invoices?from=${range.from}&to=${range.to}`}
              linkLabel="See these invoices"
            />
            <StatTile
              label="Net movement"
              value={formatAud(net)}
              sub="Sales less purchases in this period"
              tone={net >= 0 ? 'positive' : 'negative'}
              current={net}
              previous={prev?.grossMargin}
            />
            <StatTile
              label={data.sales.gst - data.purchases.gst >= 0 ? 'GST payable' : 'GST refundable'}
              value={formatAud(Math.abs(data.sales.gst - data.purchases.gst))}
              sub={`${formatAud(data.sales.gst)} collected · ${formatAud(data.purchases.gst)} paid`}
              to={`/purchases?type=TAX_INVOICE&from=${range.from}&to=${range.to}`}
              linkLabel="See GST documents"
            />
          </div>

          <div className="mb-6">
            <Card
              title="Buying and selling over time"
              subtitle={`Grouped by ${range.granularity}`}
              action={<span className="num text-xs text-steel-400">{rangeLabel}</span>}
            >
              <TimeSeriesChart data={data.series} granularity={range.granularity} />
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Most bought materials" subtitle="By value in the selected period">
              {data.topMaterialsBought.length === 0 ? (
                <EmptyState
                  action={
                    <Link
                      to="/purchases/new"
                      className="mt-3 text-sm font-medium text-copper-600 hover:text-copper-700"
                    >
                      Record a purchase →
                    </Link>
                  }
                >
                  Nothing bought in this period.
                </EmptyState>
              ) : (
                <BarList
                  items={data.topMaterialsBought.map((m) => ({
                    ...materialItem(m, 'kg'),
                    to: `/purchases?materialId=${m.material.id}&from=${range.from}&to=${range.to}`,
                  }))}
                  color={SERIES.purchases}
                />
              )}
            </Card>
            <Card title="Most sold materials" subtitle="By value in the selected period">
              {data.topMaterialsSold.length === 0 ? (
                <EmptyState
                  action={
                    <Link
                      to="/export-invoices/new"
                      className="mt-3 text-sm font-medium text-copper-600 hover:text-copper-700"
                    >
                      Raise an invoice →
                    </Link>
                  }
                >
                  Nothing sold in this period.
                </EmptyState>
              ) : (
                <BarList
                  items={data.topMaterialsSold.map((m) => materialItem(m, 'MT'))}
                  color={SERIES.sales}
                />
              )}
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card
              title="Top suppliers"
              subtitle="Who we bought the most from"
              action={
                <Link to="/clients" className="text-xs font-medium text-copper-600 hover:text-copper-700">
                  All clients →
                </Link>
              }
            >
              {data.topSuppliers.length === 0 ? (
                <EmptyState>No suppliers in this period.</EmptyState>
              ) : (
                <BarList items={data.topSuppliers.map((c) => ({ ...clientItem(c), to: `/clients/${c.client.id}` }))} color={SERIES.purchases} />
              )}
            </Card>
            <Card
              title="Top buyers"
              subtitle="Who we sold the most to"
              action={
                <Link to="/buyers" className="text-xs font-medium text-copper-600 hover:text-copper-700">
                  All buyers →
                </Link>
              }
            >
              {data.topConsignees.length === 0 ? (
                <EmptyState>No buyers in this period.</EmptyState>
              ) : (
                <BarList items={data.topConsignees.map((c) => ({ ...clientItem(c), to: `/buyers/${c.client.id}` }))} color={SERIES.sales} />
              )}
            </Card>
          </div>

          <Card
            title="Recent activity"
            subtitle="Latest documents, regardless of the filter above"
            action={
              <Link to="/purchases" className="text-xs font-medium text-copper-600 hover:text-copper-700">
                View all →
              </Link>
            }
          >
            {recent.length === 0 ? (
              <EmptyState>Nothing recorded yet.</EmptyState>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-steel-100 text-left text-[11px] uppercase tracking-wider text-steel-500">
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">Reference</th>
                    <th className="py-2 font-medium">Client</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr
                      key={r.kind + r.id}
                      className="border-b border-steel-100 last:border-0 hover:bg-paper/60"
                    >
                      <td className="py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-sm"
                            style={{ background: r.kind === 'sale' ? SERIES.sales : SERIES.purchases }}
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
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

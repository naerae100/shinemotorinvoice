import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatAud, formatNumber } from '../lib/format';
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

  if (error) return <div className="px-8 py-8 text-sm text-working-red">{error}</div>;
  if (!data) return <div className="px-8 py-8 text-sm text-steel-500">Loading…</div>;

  const party = isSupplier ? data.supplier : data.consignee;
  const docs = isSupplier ? data.dockets : data.invoices;
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

  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <Link to={listPath} className="text-sm text-steel-500 hover:text-copper-600">
        ← {isSupplier ? 'Clients' : 'Buyers'}
      </Link>
      <div className="mb-5 mt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">{party.name}</h1>
          <p className="mt-0.5 text-sm text-steel-500">
            {isSupplier
              ? [
                  party.saleType === 'BUSINESS' ? 'Business' : 'Private',
                  [party.address, party.suburb, party.postcode].filter(Boolean).join(', '),
                  party.phone,
                  party.abn && `ABN ${party.abn}`,
                  party.licenceNo && `Licence ${party.licenceNo}`,
                ]
                  .filter(Boolean)
                  .join('  ·  ')
              : [party.address, party.country, party.phone, party.email]
                  .filter(Boolean)
                  .join('  ·  ')}
          </p>
        </div>
        <Link
          to={isSupplier ? `/purchases?supplierId=${party.id}` : `/export-invoices?consigneeId=${party.id}`}
          className="whitespace-nowrap rounded-md border border-steel-300 bg-white px-4 py-2.5 text-sm font-semibold text-steel-700 hover:bg-paper"
        >
          All documents →
        </Link>
      </div>

      <div className="mb-6 rounded-xl border border-steel-200 bg-white p-3 shadow-ticket">
        <DateRangePicker {...range} showGranularity={false} onChange={setRange} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
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
              sub: `${formatNumber(m.weight, 2)} ${unit} across ${m.lines} ${m.lines === 1 ? 'line' : 'lines'}`,
            }))}
            color={color}
            emptyLabel="Nothing in this period."
          />
        </Card>

        <Card title="Recent documents">
          {docs.length === 0 ? (
            <div className="py-8 text-center text-sm text-steel-500">Nothing recorded yet.</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-steel-100 text-left text-xs uppercase tracking-wider text-steel-500">
                    <th className="py-2 font-medium">Ref</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => {
                    const isVoid = doc.status === 'VOID';
                    const to = isSupplier
                      ? `${doc.type === 'TAX_INVOICE' ? '/tax-invoices' : '/purchases'}/${doc.id}`
                      : `/export-invoices/${doc.id}`;
                    return (
                      <tr
                        key={doc.id}
                        className={`border-b border-steel-100 last:border-0 ${isVoid ? 'opacity-50' : ''}`}
                      >
                        <td className="py-2">
                          <Link
                            to={to}
                            className={`num font-medium text-steel-900 hover:text-copper-600 ${
                              isVoid ? 'line-through' : ''
                            }`}
                          >
                            {isSupplier ? `#${doc.docketNumber}` : doc.invoiceNumber}
                          </Link>
                        </td>
                        <td className="py-2 text-steel-500">
                          {format(new Date(doc.date), 'd MMM yyyy')}
                        </td>
                        <td className="num py-2 text-right font-medium text-steel-900">
                          {formatAud(isSupplier ? doc.total : doc.totalAud)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

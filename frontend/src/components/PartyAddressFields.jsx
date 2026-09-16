/**
 * The address block for a supplier or a consignee, in one place.
 *
 * It existed twice and drifted: the Buyers page captured street, suburb, state,
 * postcode and country, while adding a consignee inline from a packing slip
 * offered a single "Address" box. Two forms writing the same record disagreed
 * about what a record is.
 *
 * The labels follow the country rather than assuming Australia. "Suburb / State
 * / Postcode" is an Australian form; a Hong Kong consignee has no state and a
 * US one has a ZIP code. The yard sells into a dozen countries, so the form has
 * to ask each of them the right question.
 *
 * Country is a suggestion list, not a closed set — the field stays free text, so
 * an unfamiliar destination is never a dead end. The same reasoning as the
 * shipping terms and container types on the invoice form.
 */

// Led by where this yard actually ships, then broadened. A buyer in a country
// nobody has traded with yet can still be typed in full.
export const COUNTRIES = [
  'Australia', 'New Zealand',
  'China', 'Hong Kong', 'Taiwan', 'South Korea', 'Japan', 'Singapore',
  'Malaysia', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'Cambodia',
  'India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal',
  'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Oman', 'Turkey',
  'United States', 'Canada', 'Mexico', 'Brazil', 'Chile',
  'United Kingdom', 'Ireland', 'Germany', 'Netherlands', 'Belgium', 'France',
  'Spain', 'Portugal', 'Italy', 'Greece', 'Poland', 'Sweden', 'Norway',
  'Denmark', 'Finland', 'Switzerland', 'Austria', 'Czechia', 'Romania',
  'South Africa', 'Egypt', 'Nigeria', 'Kenya', 'Papua New Guinea', 'Fiji',
];

/** What each country calls the parts of an address. */
export function addressLabels(country) {
  const c = (country || '').trim().toLowerCase();

  if (c === 'australia' || c === 'new zealand') {
    return { suburb: 'Suburb', state: 'State', postcode: 'Postcode' };
  }
  if (c === 'united states' || c === 'usa' || c === 'united states of america') {
    return { suburb: 'City', state: 'State', postcode: 'ZIP code' };
  }
  if (c === 'canada') {
    return { suburb: 'City', state: 'Province', postcode: 'Postal code' };
  }
  if (c === 'united kingdom' || c === 'uk') {
    return { suburb: 'Town / city', state: 'County', postcode: 'Postcode' };
  }
  // Hong Kong and Singapore are city-states: a "state" field only invites a
  // wrong answer, so it is dropped rather than left blank and puzzling.
  if (c === 'hong kong' || c === 'singapore' || c === 'macau') {
    return { suburb: 'District', state: null, postcode: 'Postal code' };
  }
  return { suburb: 'City', state: 'State / province / region', postcode: 'Postal code' };
}

export default function PartyAddressFields({
  value,
  onChange,
  idPrefix = 'party',
  streetKey = 'address',
  className = '',
}) {
  const labels = addressLabels(value.country);
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });

  const field =
    'w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm focus:border-copper-500';
  const label = 'mb-1 block text-xs font-medium text-steel-500';

  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={`${idPrefix}-street`}>
          Street address
        </label>
        <input
          id={`${idPrefix}-street`}
          value={value[streetKey] || ''}
          onChange={set(streetKey)}
          placeholder="Unit G, 1/F., 16–18 Mau Lam Street"
          className={field}
        />
      </div>

      {/* Country leads the rest, because it decides what the rest are called. */}
      <div>
        <label className={label} htmlFor={`${idPrefix}-country`}>
          Country
        </label>
        <input
          id={`${idPrefix}-country`}
          list={`${idPrefix}-country-list`}
          value={value.country || ''}
          onChange={set('country')}
          placeholder="Start typing…"
          className={field}
        />
        <datalist id={`${idPrefix}-country-list`}>
          {COUNTRIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div>
        <label className={label} htmlFor={`${idPrefix}-suburb`}>
          {labels.suburb}
        </label>
        <input
          id={`${idPrefix}-suburb`}
          value={value.suburb || ''}
          onChange={set('suburb')}
          className={field}
        />
      </div>

      {labels.state && (
        <div>
          <label className={label} htmlFor={`${idPrefix}-state`}>
            {labels.state}
          </label>
          <input
            id={`${idPrefix}-state`}
            value={value.state || ''}
            onChange={set('state')}
            className={field}
          />
        </div>
      )}

      <div>
        <label className={label} htmlFor={`${idPrefix}-postcode`}>
          {labels.postcode}
        </label>
        <input
          id={`${idPrefix}-postcode`}
          value={value.postcode || ''}
          onChange={set('postcode')}
          className={`num ${field}`}
        />
      </div>
    </div>
  );
}

import StreetAddressField from './StreetAddressField';
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

/**
 * What each country calls the parts of an address, and an example of each.
 *
 * The examples are not decoration. "State" means a two-letter code here and a
 * spelt-out province elsewhere, and an operator shown "NSW" types NSW —
 * an empty box gets "New South Wales" from one person and "nsw" from the next,
 * and the supplier list then has both.
 */
export function addressLabels(country) {
  const c = (country || '').trim().toLowerCase();

  if (c === 'australia' || c === '' || c === 'au') {
    return {
      street: 'Street', streetEg: '12 Smithfield Road',
      suburb: 'Suburb', suburbEg: 'Liverpool',
      state: 'State', stateEg: 'NSW',
      postcode: 'Postcode', postcodeEg: '2170',
    };
  }
  if (c === 'new zealand') {
    return {
      street: 'Street', streetEg: '12 Queen Street',
      suburb: 'Suburb', suburbEg: 'Ponsonby',
      state: 'Region', stateEg: 'Auckland',
      postcode: 'Postcode', postcodeEg: '1011',
    };
  }
  if (c === 'united states' || c === 'usa' || c === 'united states of america') {
    return {
      street: 'Street', streetEg: '1600 Pennsylvania Ave NW',
      suburb: 'City', suburbEg: 'Washington',
      state: 'State', stateEg: 'DC',
      postcode: 'ZIP code', postcodeEg: '20500',
    };
  }
  if (c === 'united kingdom' || c === 'uk') {
    return {
      street: 'Street', streetEg: '10 Downing Street',
      suburb: 'Town / city', suburbEg: 'London',
      state: 'County', stateEg: 'Greater London',
      postcode: 'Postcode', postcodeEg: 'SW1A 2AA',
    };
  }
  // Hong Kong and Singapore are city-states: a "state" field only invites a
  // wrong answer, so it is dropped rather than left blank and puzzling.
  if (c === 'hong kong' || c === 'macau') {
    return {
      street: 'Street', streetEg: 'Unit G, 1/F., 16–18 Mau Lam Street',
      suburb: 'District', suburbEg: 'Jordan, Kowloon',
      state: null,
      postcode: 'Postal code', postcodeEg: '—',
    };
  }
  if (c === 'singapore') {
    return {
      street: 'Street', streetEg: '1 Raffles Place',
      suburb: 'District', suburbEg: 'Downtown Core',
      state: null,
      postcode: 'Postal code', postcodeEg: '048616',
    };
  }
  return {
    street: 'Street', streetEg: 'Street and number',
    suburb: 'City', suburbEg: 'City or town',
    state: 'State / province / region', stateEg: 'Province',
    postcode: 'Postal code', postcodeEg: 'Postal code',
  };
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
  const label = 'field-label';

  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={`${idPrefix}-street`}>
          Street address
        </label>
        {/* Choosing a suggestion fills the street, suburb, state and postcode
            together, so those four agree by construction rather than by the
            operator typing all four correctly. */}
        <StreetAddressField
          id={`${idPrefix}-street`}
          value={value[streetKey]}
          country={value.country}
          onChange={(v) => onChange({ ...value, [streetKey]: v })}
          onResolved={(a) =>
            onChange({
              ...value,
              [streetKey]: a.street,
              suburb: a.suburb,
              state: a.state,
              postcode: a.postcode,
              // A suggestion only ever comes from the Australian dataset, so
              // the country is known even when the field was left blank.
              country: value.country || 'Australia',
            })
          }
          placeholder={labels.streetEg}
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
          placeholder="Australia"
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
          placeholder={labels.suburbEg}
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
            placeholder={labels.stateEg}
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
          placeholder={labels.postcodeEg}
          className={`num ${field}`}
        />
      </div>
    </div>
  );
}

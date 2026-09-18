import { useState } from 'react';
import { AddressAutocomplete } from '@wattleaddr/react';

/**
 * The street line, with Australian address autocomplete where it applies.
 *
 * Typing an address at a weighbridge is slow and it is where suburb and
 * postcode get mismatched — a docket addressed to the wrong suburb is a
 * supplier record that cannot be found again. Choosing a suggestion fills the
 * street, suburb, state and postcode together, so those four agree by
 * construction rather than by the operator getting all four right.
 *
 * Two things it deliberately does not do.
 *
 * It only offers suggestions for Australian addresses. WattleAddr covers
 * Australia, and consignees are mills and traders in Hong Kong, Korea and
 * India — offering them a list that can never contain their address is worse
 * than offering nothing.
 *
 * And it is never required. Without a key configured it is an ordinary text
 * box: the yard has to be able to write a docket when a third-party service is
 * unreachable, out of quota, or simply not set up yet.
 */
const API_KEY = import.meta.env.VITE_WATTLEADDR_KEY || '';

const AU = new Set(['', 'australia', 'au', 'aus']);
const isAustralian = (country) => AU.has((country || '').trim().toLowerCase());

/** The street line as a person writes it: unit, number, street, type. */
function streetLine(c) {
  const number = [c.flat_number && `${c.flat_number}/`, c.street_number].filter(Boolean).join('');
  return [c.level_number && `Level ${c.level_number}`, number, c.street_name, c.street_type]
    .filter(Boolean)
    .join(' ')
    .trim();
}

export default function StreetAddressField({
  value,
  country,
  onChange,
  onResolved,
  id,
  className = '',
  placeholder = 'Unit G, 1/F., 16–18 Mau Lam Street',
}) {
  const [failed, setFailed] = useState(false);

  const plain = !API_KEY || failed || !isAustralian(country);

  if (plain) {
    return (
      <input
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <AddressAutocomplete
      id={id}
      apiKey={API_KEY}
      className={className}
      placeholder="Start typing an address…"
      onSelect={(address) => {
        const c = address?.components ?? {};
        onResolved?.({
          street: streetLine(c) || address?.formatted || '',
          suburb: c.locality || '',
          state: c.state || '',
          postcode: c.postcode || '',
        });
      }}
      // A lookup service being down must not take the address field with it.
      onError={() => setFailed(true)}
    />
  );
}

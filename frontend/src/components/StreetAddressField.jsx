import { useEffect, useRef, useState } from 'react';
import { AddressAutocomplete } from '@wattleaddr/react';
import { api } from '../lib/api';

/**
 * The street line, with Australian address suggestions.
 *
 * Typing an address at a weighbridge is slow, and it is where suburb and
 * postcode get mismatched — a docket filed under the wrong suburb is a supplier
 * record nobody finds again. Choosing a suggestion fills street, suburb, state
 * and postcode together, so those four agree by construction rather than by the
 * operator getting all four right.
 *
 * Three modes, in descending order of how good the data is:
 *
 *   WattleAddr   when VITE_WATTLEADDR_KEY is set. Reads G-NAF, the official
 *                Australian address file: every address, every house number.
 *   Open data    otherwise. OpenStreetMap through our own /api/address, which
 *                needs no account anywhere. Good enough to save typing, and
 *                honestly not as good: OSM's Australian coverage is
 *                contributed, so a street may carry no house numbers and a
 *                search that cannot find one sometimes answers with a
 *                similarly-named street elsewhere.
 *   Plain text   outside Australia, where neither dataset applies. Consignees
 *                are mills in Hong Kong, Korea and India, and a list that can
 *                never hold their address is worse than no list.
 *
 * In every mode the operator sees all four fields and can overwrite any of
 * them. A suggestion is a typing aid, never an authority — which matters most
 * in the middle mode, where it is sometimes wrong.
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

/** The keyless list, backed by our own endpoint. */
function OpenDataSuggestions({ value, onChange, onResolved, id, className, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const latest = useRef(0);
  // Set when a suggestion is taken, so choosing one does not immediately
  // trigger a fresh search for the text it just inserted.
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return undefined;
    }
    const q = (value || '').trim();
    if (q.length < 4) {
      setSuggestions([]);
      return undefined;
    }
    const ticket = ++latest.current;
    const t = setTimeout(() => {
      api
        .get('/address/search', { params: { q } })
        .then((res) => {
          if (ticket !== latest.current) return;
          setSuggestions(res.data.suggestions ?? []);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => ticket === latest.current && setSuggestions([]));
    }, 350);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const away = (e) => !box.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const take = (s) => {
    justPicked.current = true;
    onResolved?.(s);
    setOpen(false);
    setSuggestions([]);
  };

  const onKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      take(suggestions[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={box}>
      <input
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={className}
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-steel-200 bg-white shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => take(s)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  i === active ? 'bg-paper text-steel-900' : 'text-steel-700'
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
          <li className="border-t border-steel-100 px-3 py-1.5 text-[10px] text-steel-400">
            OpenStreetMap — check the suburb and postcode before saving
          </li>
        </ul>
      )}
    </div>
  );
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
  const [wattleFailed, setWattleFailed] = useState(false);
  const australian = isAustralian(country);

  if (!australian) {
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

  if (!API_KEY || wattleFailed) {
    return (
      <OpenDataSuggestions
        id={id}
        value={value}
        onChange={onChange}
        onResolved={(s) =>
          onResolved?.({
            street: s.street,
            suburb: s.suburb,
            state: s.state,
            postcode: s.postcode,
          })
        }
        className={className}
        placeholder={placeholder}
      />
    );
  }

  return (
    <AddressAutocomplete
      id={id}
      apiKey={API_KEY}
      className={className}
      placeholder={placeholder}
      onSelect={(address) => {
        const c = address?.components ?? {};
        onResolved?.({
          street: streetLine(c) || address?.formatted || '',
          suburb: c.locality || '',
          state: c.state || '',
          postcode: c.postcode || '',
        });
      }}
      // A key that is rejected, or a service having a bad day, drops to the
      // open-data list rather than taking the address field down with it.
      onError={() => setWattleFailed(true)}
    />
  );
}

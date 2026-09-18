import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * An ABN field that says whose ABN it is.
 *
 * The check digit already catches a mistyped number, but not a correctly-typed
 * one belonging to somebody else — which is what happens when a supplier reads
 * it off a phone at the weighbridge. Showing the registered name lets the
 * operator see whether it matches the person in front of them, before the
 * docket is written and before the PAYG declaration is made on it.
 *
 * Whether the registration is still ACTIVE matters as much as the name. "Business
 * sale with valid ABN" is a statement about a live registration; an ABN that was
 * cancelled last year still passes its check digit perfectly.
 *
 * The lookup never blocks anything. If the register is down, or no GUID has been
 * configured, the field is an ordinary text box and the docket saves as always.
 */
const DEBOUNCE_MS = 500;

export default function AbnField({
  value,
  onChange,
  id = 'abn',
  placeholder = '44 213 887 002',
  className = '',
  onEntityName,
}) {
  const [result, setResult] = useState(null);
  const [looking, setLooking] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length !== 11) {
      setResult(null);
      setLooking(false);
      return undefined;
    }

    // Typing eleven digits passes through ten intermediate states; only the one
    // still on screen half a second later is worth asking about.
    const ticket = ++latest.current;
    setLooking(true);
    const t = setTimeout(() => {
      api
        .get(`/abn/${digits}`)
        .then((res) => {
          if (ticket !== latest.current) return; // a newer keystroke won
          setResult(res.data);
          if (res.data?.entityName) onEntityName?.(res.data.entityName);
        })
        .catch(() => {
          if (ticket === latest.current) setResult(null);
        })
        .finally(() => {
          if (ticket === latest.current) setLooking(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(t);
    // onEntityName is a callback the caller may redefine each render; depending
    // on it would re-run the lookup on every keystroke of an unrelated field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const note = () => {
    if (looking) return { tone: 'muted', text: 'Checking the register…' };
    if (!result) return null;

    switch (result.status) {
      case 'ACTIVE':
        return {
          tone: 'good',
          text: result.entityName,
          sub: [
            result.entityType,
            result.gstRegistered ? 'Registered for GST' : 'Not registered for GST',
            result.businessNames?.length ? `Trading as ${result.businessNames[0]}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      case 'INACTIVE':
        return {
          tone: 'bad',
          text: result.entityName || 'Registration not active',
          // The distinction that matters: this ABN is real, and it is not live.
          // A supplier declaring a business sale on it is declaring something
          // that is no longer true.
          sub: `ABN status: ${result.abnStatus || 'not active'} — this is not a current registration`,
        };
      case 'NOT_FOUND':
        return { tone: 'bad', text: 'No such ABN on the register' };
      case 'INVALID':
        return { tone: 'bad', text: result.message };
      // NOT_CONFIGURED and UNAVAILABLE are the service's problem, not the
      // operator's, and saying nothing is better than a warning they cannot act
      // on beside a field that is working fine.
      default:
        return null;
    }
  };

  const n = note();
  const tones = {
    good: 'text-working-green',
    bad: 'text-working-red',
    muted: 'text-steel-400',
  };

  return (
    <div>
      <input
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        className={className}
      />
      {n && (
        <div className={`mt-1 text-[11px] leading-snug ${tones[n.tone]}`} aria-live="polite">
          <span className="font-semibold">{n.text}</span>
          {n.sub && <span className="mt-0.5 block text-steel-500">{n.sub}</span>}
        </div>
      )}
    </div>
  );
}

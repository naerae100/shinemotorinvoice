import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Pick a material from the price list, or type a grade that is not on it.
 *
 * A plain <select> could do neither: with 30-odd grades the operator had to
 * hunt the list by eye, and anything the list did not anticipate simply could
 * not be recorded. This filters as you type and accepts whatever you type.
 *
 * Selecting a material reports its id and its current price, so the row can
 * prefill the rate. Typing something that matches nothing reports no id and the
 * text as a description — the line is still valid, it is just a one-off.
 */
export default function MaterialField({ value, description, materials, onSelect, autoFocus }) {
  const id = useId();
  const wrap = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = materials.find((m) => m.id === value);
  const label = (m) => (m.code ? `${m.code}. ${m.description}` : m.description);

  // While closed the field shows what the line actually holds; while open it
  // shows what is being typed.
  const shown = open ? query : selected ? label(selected) : (description ?? '');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return materials.slice(0, 50);
    return materials
      .filter((m) => label(m).toLowerCase().includes(q) || String(m.code ?? '').startsWith(q))
      .slice(0, 50);
  }, [query, materials]);

  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) commitFreeText();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  });

  function choose(m) {
    onSelect({ materialId: m.id, description: '', price: m.currentPrice });
    setOpen(false);
    setQuery('');
  }

  /** Anything typed that is not a material becomes the line's own description. */
  function commitFreeText() {
    const text = query.trim();
    setOpen(false);
    setQuery('');
    if (!text) return;
    const exact = materials.find((m) => label(m).toLowerCase() === text.toLowerCase());
    if (exact) return choose(exact);
    onSelect({ materialId: '', description: text });
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Never submit the form from this field — Enter is how you accept a match.
      e.preventDefault();
      if (open && matches[active]) choose(matches[active]);
      else commitFreeText();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  const isCustom = !value && description;

  return (
    <div ref={wrap} className="relative col-span-2 sm:col-span-1">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label="Material"
        autoFocus={autoFocus}
        autoComplete="off"
        value={shown}
        placeholder="Search materials, or type your own…"
        onFocus={() => {
          setQuery('');
          setActive(0);
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm sm:bg-paper sm:focus:bg-white"
      />

      {isCustom && !open && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-copper-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-copper-700">
          one-off
        </span>
      )}

      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-steel-200 bg-white py-1 shadow-lg"
        >
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(m)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                  i === active ? 'bg-copper-50 text-steel-900' : 'text-steel-700'
                }`}
              >
                <span className="truncate">{label(m)}</span>
                {/* Only when there is one. The field collection list carries
                    no price on purpose — a contractor has no reason to know
                    what the yard pays — and rendering it regardless printed
                    "ICW 30%NaN/kg" beside every grade. */}
                {m.currentPrice != null && Number.isFinite(Number(m.currentPrice)) && (
                  <span className="num shrink-0 text-[11px] text-steel-400">
                    {Number(m.currentPrice).toFixed(2)}/{(m.unit || 'KG').toLowerCase()}
                  </span>
                )}
              </button>
            </li>
          ))}

          {query.trim() && !matches.some((m) => label(m).toLowerCase() === query.trim().toLowerCase()) && (
            <li className="border-t border-steel-100">
              <button
                type="button"
                onClick={commitFreeText}
                className="w-full px-3 py-2 text-left text-sm text-copper-700 hover:bg-copper-50"
              >
                Use “{query.trim()}” as a one-off grade
              </button>
            </li>
          )}

          {!matches.length && !query.trim() && (
            <li className="px-3 py-2 text-sm text-steel-400">No materials yet — type a grade.</li>
          )}
        </ul>
      )}
    </div>
  );
}

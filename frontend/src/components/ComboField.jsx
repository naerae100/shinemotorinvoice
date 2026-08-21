import { useId } from 'react';

/**
 * A text input with suggestions — you can pick a common value or type your own.
 *
 * These were plain <select>s, which meant a shipping term or container type the
 * list didn't anticipate simply could not be recorded. Trade paperwork has a
 * long tail (DDP, 45ft HC, reefer, flat rack…), so the field suggests the usual
 * answers without refusing anything else.
 */
export default function ComboField({
  label,
  value,
  onChange,
  options = [],
  placeholder,
  className = '',
  hint,
}) {
  const id = useId();
  const listId = `${id}-options`;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-steel-500">
          {label}
        </label>
      )}
      <input
        id={id}
        list={listId}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-steel-200 bg-paper px-3 py-2 text-sm text-steel-900 transition-colors placeholder:text-steel-400 focus:border-copper-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-copper-500/20"
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
      {hint && <p className="mt-1 text-[11px] text-steel-400">{hint}</p>}
    </div>
  );
}

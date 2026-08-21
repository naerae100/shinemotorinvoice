import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Keeps a filter set in the URL rather than in component state.
 *
 * This is what makes a figure on the dashboard clickable: "34 dockets" can link
 * to the list already filtered to the same period. It also means the back
 * button works, and a filtered view can be bookmarked or sent to someone.
 */
export function useUrlFilters(defaults) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = searchParams.get(key);
      if (value !== null) out[key] = value;
    }
    return out;
  }, [searchParams, defaults]);

  const setFilters = useCallback(
    (patch, { resetPage = true } = {}) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            // A value equal to the default is left out, so URLs stay short and
            // "no filter" reads the same whether it was never set or was cleared.
            if (value === '' || value === null || value === undefined || value === defaults[key]) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams, defaults]
  );

  const clearFilters = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);

  const isFiltered = useMemo(
    () => Object.keys(defaults).some((k) => k !== 'page' && searchParams.get(k)),
    [searchParams, defaults]
  );

  return { filters, setFilters, clearFilters, isFiltered };
}

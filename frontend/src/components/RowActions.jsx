import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

const MENU_WIDTH = 176; // w-44

/**
 * Per-row action menu. The old table linked only from the reference number,
 * which gave no hint that anything was clickable — several actions were simply
 * undiscoverable.
 *
 * The menu is rendered through a portal rather than next to its button. The
 * table sits in an `overflow-x-auto` container so a wide table can scroll on a
 * narrow screen, and CSS will not let one axis scroll while the other stays
 * visible — overflow-y computes to auto as well. An absolutely positioned menu
 * was therefore clipped by the container, which is most obvious with a single
 * row, where the card is barely taller than the menu. Portalling to the body
 * takes the menu out of that box entirely.
 */
export default function RowActions({ viewTo, onEdit, onVoid, onRestore, isVoid, isAdmin }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const rowRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  // Position against the trigger in viewport coordinates, flipping above it
  // when there is not enough room below — the last row of a list is the common
  // case, and a menu that opens off the bottom of the window is unusable.
  useLayoutEffect(() => {
    if (!open) return undefined;

    const place = () => {
      const trigger = buttonRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const h = menuRef.current?.offsetHeight ?? 0;
      const roomBelow = window.innerHeight - r.bottom;
      const flipUp = roomBelow < h + 12 && r.top > h + 12;
      setPos({
        top: flipUp ? r.top - h - 4 : r.bottom + 4,
        left: Math.min(
          Math.max(8, r.right - MENU_WIDTH),
          window.innerWidth - MENU_WIDTH - 8
        ),
      });
    };

    place();
    // Capture phase: the scroll may happen on the table container, not window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      // The menu is no longer inside the row, so both subtrees have to be
      // checked or clicking an item would close before it fired.
      if (rowRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = 'block w-full px-3 py-2 text-left text-sm hover:bg-paper';
  const btn =
    'rounded-md border border-steel-200 bg-white px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper';

  const hasMenu = (!isVoid && onVoid) || (isVoid && onRestore);

  const close = () => setOpen(false);

  return (
    <div className="flex items-center justify-end gap-1" ref={rowRef}>
      <Link to={viewTo} className={btn}>
        View
      </Link>
      {!isVoid && onEdit && (
        <button type="button" onClick={onEdit} className={btn}>
          Edit
        </button>
      )}
      {hasMenu && (
        <>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="More actions"
            aria-expanded={open}
            aria-haspopup="menu"
            className="rounded-md border border-steel-200 bg-white px-2 py-1 text-xs font-semibold text-steel-600 hover:bg-paper"
          >
            ⋯
          </button>
          {open &&
            createPortal(
              <div
                ref={menuRef}
                role="menu"
                style={{
                  position: 'fixed',
                  // Rendered off-screen for the first paint so its height can be
                  // measured before it is placed; the layout effect runs before
                  // the browser paints, so this is never visible.
                  top: pos?.top ?? -9999,
                  left: pos?.left ?? -9999,
                  width: MENU_WIDTH,
                }}
                className="z-50 overflow-hidden rounded-md border border-steel-200 bg-white py-1 shadow-lg"
              >
                <Link to={viewTo} className={item} onClick={close} role="menuitem">
                  View &amp; print PDF
                </Link>
                {/* Reversing a financial record is admin-only on the server.
                    Shown disabled rather than hidden so a staff member can see
                    the action exists and knows to ask, instead of meeting a
                    bare 403 or concluding the system is broken. */}
                {!isVoid && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!isAdmin}
                    title={isAdmin ? undefined : 'Only an administrator can void a record.'}
                    className={`${item} text-working-amber disabled:cursor-not-allowed disabled:text-steel-300`}
                    onClick={() => {
                      close();
                      onVoid();
                    }}
                  >
                    Void…
                  </button>
                )}
                {isVoid && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!isAdmin}
                    title={isAdmin ? undefined : 'Only an administrator can restore a record.'}
                    className={`${item} text-working-green disabled:cursor-not-allowed disabled:text-steel-300`}
                    onClick={() => {
                      close();
                      onRestore();
                    }}
                  >
                    Restore
                  </button>
                )}
              </div>,
              document.body
            )}
        </>
      )}
    </div>
  );
}

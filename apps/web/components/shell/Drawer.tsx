"use client";
/**
 * Drawer — right-side slide-over for secondary detail (console v3).
 *
 * Props
 *   open:      boolean            — whether the drawer is shown
 *   onClose:   () => void         — called on Esc, the ✕ button, or a click on the scrim
 *   title:     ReactNode          — heading in the drawer's top line
 *   width?:    number             — px width (default 420); capped at 100vw
 *   modal?:    boolean            — default true: dims content behind and closes on scrim click.
 *                                   false: no scrim, content behind stays interactive (e.g. a
 *                                   drawer that is open by default on a tab).
 *   actions?:  ReactNode          — optional controls placed left of the ✕ in the header
 *   children:  ReactNode          — body; scrolls on its own
 *
 * Behaviour: overlays content (position fixed, between the top bar and demo bar: var(--topbar-h) / var(--demobar-h), both 0 in immersive), Esc closes (stopping the
 * event so the console's global Esc handler doesn't also fire), focus moves into the drawer on open
 * and returns to the previously focused element on close. Unboxed: white, one hairline on the left,
 * no shadow, no rounded corners. Slide respects prefers-reduced-motion.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  width?: number;
  modal?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}

export function Drawer({ open, onClose, title, width = 420, modal = true, actions, children }: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const reduce = useReducedMotion();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement;
    const t = window.setTimeout(() => panel.current?.focus({ preventScroll: true }), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
      }
    };
    // capture so we run before the console's window-level shortcut handler
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      const p = prevFocus.current as HTMLElement | null;
      if (p && typeof p.focus === "function" && document.contains(p)) p.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {modal && (
            <motion.div
              key="scrim"
              className="fixed inset-x-0 bottom-[var(--demobar-h,48px)] top-[var(--topbar-h,52px)] z-40 bg-[color-mix(in_srgb,var(--fg)_6%,transparent)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.15 }}
              onClick={onClose}
              aria-hidden
            />
          )}
          <motion.aside
            key="panel"
            ref={panel}
            role="dialog"
            aria-modal={modal}
            aria-label={typeof title === "string" ? title : undefined}
            tabIndex={-1}
            className="fixed bottom-[var(--demobar-h,48px)] right-0 top-[var(--topbar-h,52px)] z-50 flex max-w-[100vw] flex-col border-l border-rule bg-bg outline-none focus-visible:shadow-none focus-visible:outline-none"
            style={{ width }}
            initial={reduce ? { opacity: 0 } : { x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: 32, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-rule pl-6 pr-3">
              <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">{title}</h2>
              {actions}
              <button
                type="button"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-fg"
                aria-label="Close (Esc)"
                title="Close (Esc)"
              >
                <X size={16} />
              </button>
            </header>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** A label/value row for drawer bodies: hairline-separated, no boxes. */
export function DrawerRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-rule py-2.5 text-[13px] last:border-b-0">
      <div className="text-muted">{label}</div>
      <div className="min-w-0 break-words text-fg">{children}</div>
    </div>
  );
}

export default Drawer;

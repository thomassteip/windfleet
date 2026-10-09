"use client";

// The top bar every side panel shares, so they look and behave alike: a way
// back on the left only where there's a level to go back to (a maker profile
// -> all makers), the panel's own actions and the close button on the right.
// Until Oct 2026 analytics said "← back to globe" while makers had a ✕.

export const PANEL_ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-md border border-edge/70 text-muted transition hover:border-accent hover:text-fg";

export const PANEL_BACK =
  "font-mono text-xs text-muted transition hover:text-fg";

export default function PanelBar({ back = null, actions = null, onClose, closeLabel = "Close panel" }) {
  return (
    <div className="mb-4 flex min-h-[1.75rem] items-center justify-between gap-3">
      <div className="min-w-0">{back}</div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {onClose && (
          <button onClick={onClose} aria-label={closeLabel} title="Close (Esc)" className={PANEL_ICON_BTN}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

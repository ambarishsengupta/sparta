'use client';
import { useEffect, useId, useRef } from 'react';

/** The in-page confirmation that replaces the browser's own dialog (the pattern of the Leave flow and the admin take-down): the question stays on the page, nothing happens until the
 * red button is pressed, and Cancel (or Escape) puts the page back as it was. Focus moves to Cancel, the safe choice, and the question is read with it; on close, focus goes back to the
 * control that opened the step. Keep that control on the page while the step is open, so there is somewhere to return to.
 * `busy` is true while the confirmed work runs: the red button keeps its label and its place in the tab order but is aria-disabled and aria-busy, and a press does nothing, so Delete cannot be pressed twice. Cancel stays usable unless `cancelWhileBusy` is false (use that when the work cannot be taken back: Cancel would be a lie): then Cancel is aria-disabled and Escape is ignored while busy. */
export function ConfirmStep({ label, question, confirmLabel, onConfirm, onCancel, busy = false, cancelWhileBusy = true }: { label: string; question: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; cancelWhileBusy?: boolean }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const said = useId();
  const locked = busy && !cancelWhileBusy; // the confirmed work cannot be called off
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => opener?.focus();
  }, []);
  return (
    <div role="group" aria-label={label} className="form" onKeyDown={(e) => { if (e.key === 'Escape' && !locked) { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <p id={said}><strong>{question}</strong></p>
      <div className="row">
        <button type="button" className="danger" onClick={busy ? undefined : onConfirm} aria-disabled={busy || undefined} aria-busy={busy || undefined}>{confirmLabel}</button>
        <button type="button" ref={cancel} aria-describedby={said} onClick={locked ? undefined : onCancel} aria-disabled={locked || undefined}>Cancel</button>
      </div>
    </div>
  );
}

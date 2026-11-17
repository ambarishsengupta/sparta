'use client';
import { useEffect, useId, useRef } from 'react';

/** The in-page confirmation that replaces the browser's own dialog (the pattern of the Leave flow and the admin take-down): the question stays on the page, nothing happens until the
 * red button is pressed, and Cancel (or Escape) puts the page back as it was. Focus moves to Cancel, the safe choice, and the question is read with it; on close, focus goes back to the
 * control that opened the step. Keep that control on the page while the step is open, so there is somewhere to return to. */
export function ConfirmStep({ label, question, confirmLabel, onConfirm, onCancel }: { label: string; question: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const said = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => opener?.focus();
  }, []);
  return (
    <div role="group" aria-label={label} className="form" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <p id={said}><strong>{question}</strong></p>
      <div className="row">
        <button type="button" className="danger" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" ref={cancel} aria-describedby={said} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

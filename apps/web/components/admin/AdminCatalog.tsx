'use client';
import { useCallback, useEffect, useState } from 'react';
import { CATEGORIES, subTypesOf } from '@sparta/taxonomy';
import type { Category } from '@sparta/taxonomy';
import { TAKEDOWN_NOTE_MAX } from '../../lib/admin-catalog';
import { isNoLoginDemo } from '../../lib/demo-mode';
import { demoReviewQueue, type DemoReviewItem, type ReviewState } from '../../lib/demo-vendor';
import { ProductPhoto } from '../ui/ProductPhoto';
import { REVIEW_PATH, SOURCES_PATH, adminCall, takedownPath } from './admin-actions';

export interface Source { id: number; name: string; site_url: string; robots_allowed: boolean; terms_note: string; allowed: boolean; checked_on: string; contact: string | null; takedown_at: string | null; takedown_note: string | null }
export interface ReviewItem { id: string; source_id: number; sku: string; name: string; brand: string | null; product_url: string }
const NEW_SOURCE = { name: '', site_url: '', robots_allowed: false, terms_note: '', checked_on: '', contact: '' };
export const sourceState = (s: Pick<Source, 'allowed' | 'takedown_at'>): string => (s.takedown_at ? 'Taken down' : s.allowed ? 'Allowed' : 'Not allowed');

/** The take-down confirmation (FR-103): says what will happen, asks for an optional note, and acts only on the second button. */
export function TakedownConfirm({ source, onConfirm, onCancel }: { source: Source; onConfirm: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  return (
    <div role="group" aria-label={`Confirm take-down of ${source.name}`} className="form">
      <p><strong>Take down {source.name}?</strong> Every catalogue item from this source is deleted and cannot be brought back. The source stays in the register as not allowed. People who saved one of its items keep their own entry and lose only the link.</p>
      <label>Note for the record (optional)
        <input type="text" value={note} maxLength={TAKEDOWN_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" className="danger" onClick={() => onConfirm(note)}>Confirm take-down</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** One review row: map it to a category and sub-type and make it active, or withdraw it (FR-102). */
function ReviewRow({ item, onDecide }: { item: ReviewItem; onDecide: (body: Record<string, string>) => void }) {
  const [category, setCategory] = useState<Category | ''>('');
  const [subType, setSubType] = useState('');
  return (
    <li className="card">
      <div className="grow">
        <p className="title">{item.name}</p>
        <p className="muted">{[item.brand, item.sku].filter(Boolean).join(' · ')}</p>
        <div className="row">
          <label>Category
            <select value={category} onChange={(e) => { setCategory(e.target.value as Category | ''); setSubType(''); }}>
              <option value="">Choose</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>Sub-type
            <select value={subType} disabled={category === ''} onChange={(e) => setSubType(e.target.value)}>
              <option value="">Choose</option>
              {category !== '' && subTypesOf(category).map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <button type="button" disabled={category === '' || subType === ''} onClick={() => onDecide({ id: item.id, decision: 'activate', category, sub_type: subType })}>Make active</button>
          <button type="button" className="danger" onClick={() => onDecide({ id: item.id, decision: 'withdraw' })}>Withdraw</button>
        </div>
      </div>
    </li>
  );
}

export function AdminCatalog() {
  return isNoLoginDemo() ? <DemoAdminCatalog /> : <LiveAdminCatalog />;
}

const STATE_LABEL: Record<ReviewState, string> = { new: 'New', approved: 'Approved', rejected: 'Rejected' };
/** The no-login demo: the review queue of 10 catalogue items as a photo grid. Approve and Reject change the state in memory only; nothing is called or stored. */
function DemoAdminCatalog() {
  const [items, setItems] = useState<DemoReviewItem[]>(demoReviewQueue);
  const decide = (id: string, state: ReviewState) => setItems((all) => all.map((i) => (i.id === id ? { ...i, state } : i)));
  const count = (state: ReviewState) => items.filter((i) => i.state === state).length;
  return (
    <>
      <h1>Catalogue review</h1>
      <p className="muted" role="status">{count('new')} new, {count('approved')} approved, {count('rejected')} rejected. Demo only: decisions are kept on this page and nothing is saved.</p>
      <h2>Review queue</h2>
      <ul className="list tiles">
        {items.map((i) => (
          <li key={i.id} className="card item">
            <div className="swatch"><ProductPhoto id={i.photoId} name={i.name} /></div>
            <div className="grow">
              <p className="title">{i.name}</p>
              <p className="muted">{[i.category, i.subType].filter(Boolean).join(' · ')} · {STATE_LABEL[i.state]}</p>
              <div className="row">
                <button type="button" disabled={i.state === 'approved'} onClick={() => decide(i.id, 'approved')} aria-label={`Approve ${i.name}`}>Approve</button>
                <button type="button" className="danger" disabled={i.state === 'rejected'} onClick={() => decide(i.id, 'rejected')} aria-label={`Reject ${i.name}`}>Reject</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function LiveAdminCatalog() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [form, setForm] = useState(NEW_SOURCE);
  const [confirming, setConfirming] = useState<Source | null>(null);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const load = useCallback(async () => {
    const [s, r] = await Promise.all([adminCall<{ sources: Source[] }>(SOURCES_PATH, 'GET'), adminCall<{ items: ReviewItem[] }>(REVIEW_PATH, 'GET')]);
    if (s.ok) setSources(s.data.sources); else { setSources([]); setProblem(s.message); }
    if (r.ok) setReview(r.data.items); else { setReview([]); setProblem(r.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (go: () => Promise<{ ok: boolean; message?: string }>, done: string) => {
    setProblem(''); setMessage('');
    const r = await go();
    if (r.ok) { setMessage(done); await load(); } else setProblem(r.message ?? '');
  };
  const set = (patch: Partial<typeof NEW_SOURCE>) => setForm({ ...form, ...patch });

  return (
    <>
      <h1>Catalogue admin</h1>
      {problem && <p role="alert" className="error">{problem}</p>}
      <p role="status" className="muted">{message}</p>

      <h2>Source register</h2>
      {sources === null ? <p className="muted">Loading…</p> : sources.length === 0 ? <p className="muted">No sources yet.</p> : (
        <ul className="list">
          {sources.map((s) => (
            <li key={s.id} className="card">
              <div className="grow">
                <p className="title">{s.name} <span className="muted">{sourceState(s)}</span></p>
                <p className="muted">{s.site_url} · robots.txt {s.robots_allowed ? 'allows' : 'does not allow'} collection · checked {s.checked_on}</p>
                <div className="row">
                  {s.allowed
                    ? <button type="button" onClick={() => void act(() => adminCall(SOURCES_PATH, 'PATCH', { id: s.id, allowed: false }), `${s.name} is no longer allowed.`)}>Stop allowing</button>
                    : <button type="button" onClick={() => void act(() => adminCall(SOURCES_PATH, 'PATCH', { id: s.id, allowed: true }), `${s.name} is allowed.`)}>Allow</button>}
                  <button type="button" className="danger" onClick={() => setConfirming(s)}>Take down…</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirming && (
        <TakedownConfirm source={confirming} onCancel={() => setConfirming(null)}
          onConfirm={(note) => { const s = confirming; setConfirming(null); void act(() => adminCall(takedownPath(s.id), 'POST', note.trim() === '' ? {} : { note }), `${s.name} was taken down.`); }} />
      )}

      <h3>Add a source</h3>
      <p className="muted">A source can be allowed only after its terms were read, robots.txt permits collection and the check date is recorded (Data Sourcing Policy section 4).</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void act(async () => { const r = await adminCall(SOURCES_PATH, 'POST', { ...form, contact: form.contact.trim() === '' ? null : form.contact }); if (r.ok) setForm(NEW_SOURCE); return r; }, 'Source added. It is not allowed until you allow it.'); }}>
        <label>Name<input type="text" value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} /></label>
        <label>Site address<input type="text" inputMode="url" value={form.site_url} maxLength={300} onChange={(e) => set({ site_url: e.target.value })} /></label>
        <label className="row"><input type="checkbox" checked={form.robots_allowed} onChange={(e) => set({ robots_allowed: e.target.checked })} /> robots.txt permits collection</label>
        <label>Terms note<textarea value={form.terms_note} maxLength={1000} onChange={(e) => set({ terms_note: e.target.value })} /></label>
        <label>Checked on<input type="date" value={form.checked_on} onChange={(e) => set({ checked_on: e.target.value })} /></label>
        <label>Contact (optional)<input type="text" value={form.contact} maxLength={200} onChange={(e) => set({ contact: e.target.value })} /></label>
        <button type="submit" className="primary">Add source</button>
      </form>

      <h2>Review queue</h2>
      {review === null ? <p className="muted">Loading…</p> : review.length === 0 ? <p className="muted">Nothing is waiting for review.</p> : (
        <ul className="list">
          {review.map((i) => <ReviewRow key={i.id} item={i} onDecide={(body) => void act(() => adminCall(REVIEW_PATH, 'POST', body), body.decision === 'activate' ? `${i.name} is now active.` : `${i.name} was withdrawn.`)} />)}
        </ul>
      )}
    </>
  );
}

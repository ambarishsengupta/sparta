'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { abortableSleep, addByPhoto, attachmentOf, prefillFrom } from '../../lib/photo-flow';
import type { ImageChoice, PhotoResult, Stage } from '../../lib/photo-flow';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { dataBackend } from '../../lib/supabase/config';
import { ItemForm } from './ItemForm';
import { photoDeps, previewUrls } from './photo-backend';

const STAGE_TEXT: Record<Stage, string> = {
  preparing: 'Preparing your photo…',
  uploading: 'Uploading your photo…',
  queued: 'Waiting for your photo to be processed…',
  processing: 'Removing the background…',
};

type Step =
  | { name: 'choose' }
  | { name: 'working'; stage: Stage }
  | { name: 'preview'; result: PhotoResult; urls: Record<string, string> }
  | { name: 'form'; result: PhotoResult; choice: ImageChoice; urls: Record<string, string> };

/** Add an item by photo (FR-23): choose, wait, preview (cut-out or original), then the add-item form, filled in where the photo could tell. */
export function PhotoItemFlow() {
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const [message, setMessage] = useState('');
  const [pick, setPick] = useState<ImageChoice>('cutout');
  const control = useRef<AbortController | null>(null);
  // Leaving the page stops the wait at once (the poll's timer is cleared inside abortableSleep).
  useEffect(() => () => control.current?.abort(), []);

  if (dataBackend() !== 'supabase') {
    return (
      <>
        <h1>Add by photo</h1>
        <p>Adding an item by photo needs your account, because the photo is kept privately for you. In this browser-only mode you can add the item by hand.</p>
        <Link href="/items/new" className="button">Add item by hand</Link>
      </>
    );
  }

  const start = async (file: File) => {
    control.current?.abort();
    const ctl = new AbortController();
    control.current = ctl;
    setMessage('');
    setStep({ name: 'working', stage: 'preparing' });
    const client = createBrowserSupabase();
    const outcome = await addByPhoto(file, photoDeps(client, abortableSleep), { signal: ctl.signal, onStage: (stage) => { if (!ctl.signal.aborted) setStep({ name: 'working', stage }); } });
    if (ctl.signal.aborted) return;
    if (!outcome.ok) { setMessage(outcome.message); setStep({ name: 'choose' }); return; }
    const urls = await previewUrls(client, [outcome.result.thumbPath, outcome.result.originalThumbPath]);
    if (!ctl.signal.aborted) setStep({ name: 'preview', result: outcome.result, urls });
  };

  if (step.name === 'form') {
    const { result, choice, urls } = step;
    const shown = urls[choice === 'cutout' ? result.thumbPath : result.originalThumbPath];
    return (
      <>
        {shown && <img className="photo-thumb" src={shown} alt={choice === 'cutout' ? 'Your photo, background removed' : 'Your original photo'} width={160} height={160} />}
        <ItemForm photoStart={{ ...prefillFrom(result), photo: attachmentOf(result, choice) }} />
      </>
    );
  }

  if (step.name === 'preview') {
    const { result, urls } = step;
    const options: [ImageChoice, string, string][] = [['cutout', 'Use the cut-out', result.thumbPath], ['original', 'Keep my original', result.originalThumbPath]];
    return (
      <form className="form" onSubmit={(e) => { e.preventDefault(); setStep({ name: 'form', result, choice: pick, urls }); }}>
        <h1>Check your photo</h1>
        <fieldset>
          <legend>Which picture should we keep?</legend>
          <div className="previews">
            {options.map(([value, label, path]) => (
              <label key={value} className="preview">
                <span className="frame">
                  {urls[path] ? <img src={urls[path]} alt={value === 'cutout' ? 'Preview with the background removed' : 'Preview of your original photo'} width={160} height={160} /> : <span className="muted">Preview not available</span>}
                </span>
                <span className="check"><input type="radio" name="picture" value={value} checked={pick === value} onChange={() => setPick(value)} />{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <button type="submit" className="primary">Continue</button>
          <button type="button" onClick={() => { setStep({ name: 'choose' }); setMessage(''); }}>Choose another photo</button>
        </div>
      </form>
    );
  }

  const working = step.name === 'working';
  return (
    <div className="form">
      <h1>Add by photo</h1>
      <p className="muted">Your photo is kept privately for you. The background is removed so the item is easy to see.</p>
      {message && <p role="alert" className="error">{message}</p>}
      <label>Choose a photo
        <input type="file" accept="image/*" disabled={working} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void start(f); }} />
      </label>
      {working && <p role="status" aria-live="polite">{STAGE_TEXT[step.stage]}</p>}
      <p><Link href="/items/new">Add the item without a photo</Link></p>
    </div>
  );
}

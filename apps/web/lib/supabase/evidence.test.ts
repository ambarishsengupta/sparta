import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WO-0053 item 11 and M3: the evidence notes must not carry the stale claims the review found, and must say what the headers do not cover.
const evidence = (name: string) => readFileSync(new URL(`../../../../workflow/evidence/R2b/${name}`, import.meta.url), 'utf8');
describe('the R2b evidence notes', () => {
  it('do not say that no commits were made (the work was committed as a212fde)', () => {
    expect(evidence('NOTES.md')).not.toMatch(/no commits were made/i);
    expect(evidence('NOTES.md')).toContain('a212fde');
  });
  it('do not say that screenshot 10 shows the ticked occasions; they say what it does show', () => {
    const t = evidence('TRANSCRIPT.md');
    expect(t).not.toContain('ticked Casual and Work by clicks (10;');
    expect(t).toMatch(/Screenshot 10 shows those three selects filled and all seven occasion boxes still UNTICKED/);
  });
  it('state that the Content-Security-Policy is partial and a full script-src policy is later work', () => {
    const n = evidence('NOTES.md');
    expect(n).toMatch(/PARTIAL on purpose/);
    expect(n).toMatch(/script-src/);
    expect(n).toMatch(/LATER work/);
  });
  it('the screenshots they cite exist', () => {
    for (const f of ['23-wo53-sign-in-next-outfits-lands-on-outfits.jpg', '24-wo53-sign-in-redirect-payload-stays-on-app.jpg']) {
      expect(existsSync(new URL(`../../../../workflow/evidence/R2b/screenshots/${f}`, import.meta.url)), f).toBe(true);
    }
  });
});

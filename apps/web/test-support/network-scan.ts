/** The strict no-network rule of the suggestion path (FR-59), as one function so a test can prove that it catches a mutant. Test support only. */
export const NETWORK = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|axios)\b|https?:\/\//;

/** The only things the rule lets through, each removed once from the named file before the scan. Nothing else, in any file. */
export const ALLOWED: Record<string, string[]> = {
  // WO-0012: the two fixed same-origin GETs of the learned files
  'lib/engine-config.ts': ['fetch(PRIOR_URL, init())', 'fetch(UNLOCK_URL, init())'],
  // WO-0071: the one same-origin POST of the Leave flow (a fixed path; the default sender of purgeMyStorage, replaced by a fake in tests)
  'components/account/account-actions.ts': ['fetch(p, i)'],
  // WO-0088: the same-origin calls of the admin catalogue page to its three fixed routes (the default sender of adminCall, replaced by a fake in tests)
  'components/admin/admin-actions.ts': ['fetch(p, i)'],
  // the placeholder host that is only ever parsed against, never contacted (one literal in each file)
  'lib/auth-form.ts': ['http://sparta.invalid'],
  'lib/supabase/gate.ts': ['http://sparta.invalid'],
};

const without = (s: string, part: string) => s.replace(part, '');
/** What is left of a file's code that matches the rule (an empty list is a pass). `file` is the path below apps/web. */
export function networkOffences(file: string, text: string): string[] {
  let code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const part of ALLOWED[file] ?? []) code = without(code, part);
  return [...code.matchAll(new RegExp(NETWORK.source, 'g'))].map((m) => m[0]);
}

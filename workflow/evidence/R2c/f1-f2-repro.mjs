// WO-0062 F1 and F2 repro against the LOCAL stack only. Run: node workflow/evidence/R2c/f1-f2-repro.mjs
// Keys are read at run time from `supabase status -o json` and are never written anywhere. The "stale" token is signed with the local stack's
// own JWT secret (the well-known local development secret), claiming a primary sign-in one hour ago; the "fresh" token is a real GoTrue token.
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const st = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().replace(/^[^{]*/, ''));
if (!/^http:\/\/127\.0\.0\.1:/.test(st.API_URL)) throw new Error('local stack only');
const psql = (q) => execFileSync('docker', ['exec', 'supabase_db_sparta', 'psql', '-U', 'postgres', '-At', '-c', q]).toString().trim();
const post = async (path, body, key, bearer = key) => { const r = await fetch(st.API_URL + path, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${bearer}`, 'content-type': 'application/json', 'content-profile': 'app' }, body: JSON.stringify(body) }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }; };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const forge = (claims) => { const h = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`; return `${h}.${createHmac('sha256', st.JWT_SECRET).update(h).digest('base64url')}`; };
const now = () => Math.floor(Date.now() / 1000);
const pw = `Pw-${randomBytes(9).toString('base64url')}9!`;
const auditHits = (uid, email) => psql(`select count(*) from auth.audit_log_entries where payload::text ilike '%${uid}%' or payload::text ilike '%${email}%'`);
const make = async (label) => {
  const email = `repro-${label}-${randomBytes(4).toString('hex')}@example.test`;
  const c = await post('/auth/v1/admin/users', { email, password: pw, email_confirm: true }, st.SECRET_KEY);
  const si = await post('/auth/v1/token?grant_type=password', { email, password: pw }, st.PUBLISHABLE_KEY);
  return { email, uid: c.body.id, token: si.body.access_token };
};
const claimsOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const rpc = (token) => post('/rest/v1/rpc/delete_my_account', {}, st.PUBLISHABLE_KEY, token);

console.log('--- real GoTrue token claims (amr):', JSON.stringify(claimsOf((await make('peek')).token).amr));
psql(`delete from auth.users where email like 'repro-peek-%'`);
for (const kind of ['stale', 'fresh']) {
  const u = await make(kind);
  const token = kind === 'stale' ? forge({ ...claimsOf(u.token), amr: [{ method: 'password', timestamp: now() - 3600 }] }) : u.token;
  console.log(`--- ${kind} token: amr=${JSON.stringify(claimsOf(token).amr)}`);
  console.log(`audit rows naming the user before: ${auditHits(u.uid, u.email)}`);
  const r = await rpc(token);
  console.log(`RPC delete_my_account -> HTTP ${r.status} ${JSON.stringify(r.body)}`);
  console.log(`user still exists: ${psql(`select count(*) from auth.users where id='${u.uid}'`) === '1'}; audit rows naming the user after: ${auditHits(u.uid, u.email)}`);
  psql(`delete from auth.users where id='${u.uid}'; delete from auth.audit_log_entries where payload::text ilike '%${u.uid}%' or payload::text ilike '%${u.email}%'`);
}

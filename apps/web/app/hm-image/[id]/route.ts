import { readFile, stat } from 'node:fs/promises';
import { hmImagePath } from '../../../lib/server/hm-demo';

// WO-0121: local demo only. Serves one H&M product photograph from the local folder when HM_DEMO_IMAGE_ROOT is set; otherwise 404.
// It sits behind the proxy like every page. Only GET is exported. The id is never logged.
export const dynamic = 'force-dynamic';
const MAX_BYTES = 2 * 1024 * 1024;
const missing = (): Response => new Response(null, { status: 404 });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const file = hmImagePath((await params).id);
  if (file === null) return missing();
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_BYTES) return missing();
    const bytes = await readFile(file);
    if (bytes.length > MAX_BYTES) return missing();
    return new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
  } catch { return missing(); }
}

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { hmImagePath } from '../../../lib/server/hm-demo';

// WO-0121: local demo only. Serves one H&M product photograph from the local folder when HM_DEMO_IMAGE_ROOT is set; otherwise 404.
// It sits behind the proxy like every page. Only GET is exported. The id is never logged.
// WO-0130 (4): the file is opened once; the size is checked on that handle and at most the size the handle reported (which is within the limit) is read from the same handle, which is closed in a finally.
export const dynamic = 'force-dynamic';
const MAX_BYTES = 2 * 1024 * 1024;
const missing = (): Response => new Response(null, { status: 404 });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const file = hmImagePath((await params).id);
  if (file === null) return missing();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK)   // O_NONBLOCK: a named pipe opens at once and is refused by isFile() below, instead of blocking until someone writes;
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) return missing();
    const buffer = Buffer.alloc(info.size + 1)   // one spare byte: a file that grew after the stat fills it and is refused;
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > info.size) return missing();
    }
    return new Response(new Uint8Array(buffer.subarray(0, length)), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
  } catch { return missing(); } finally { await handle?.close().catch(() => undefined); }
}

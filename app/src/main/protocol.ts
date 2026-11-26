import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_SECURITY_POLICY } from './security';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function headers(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

/**
 * Handler of the `app://` protocol: serves files of the renderer build only, with the CSP header (spec §3.2).
 * Paths outside the renderer folder, also via `..` or symbolic links, answer 404.
 */
export function createAppProtocolHandler(rendererDir: string): (request: Request) => Promise<Response> {
  const root = path.resolve(rendererDir);
  const notFound = (): Response => new Response('Nicht gefunden', { status: 404, headers: headers('text/plain; charset=utf-8') });

  return async (request) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return notFound();
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return notFound();
    try {
      const real = await realpath(candidate);
      const realRoot = await realpath(root);
      if (!real.startsWith(`${realRoot}${path.sep}`)) return notFound();
      const body = await readFile(real);
      const type = MIME[path.extname(real).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(body), { status: 200, headers: headers(type) });
    } catch {
      return notFound();
    }
  };
}

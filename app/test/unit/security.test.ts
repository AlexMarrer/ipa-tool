import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppProtocolHandler } from '../../src/main/protocol';
import { CONTENT_SECURITY_POLICY, FUSE_POLICY, WEB_PREFERENCES_POLICY, isNavigationAllowed, permissionRequestHandler } from '../../src/main/security';
import { FUSES } from '../../scripts/after-pack.mjs';

describe('Sicherheitseinstellungen des Hauptfensters (AK-10-03)', () => {
  it('schaltet Isolation und Sandbox ein und Node im Renderer aus', () => {
    expect(WEB_PREFERENCES_POLICY).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
    });
  });

  it('hat genau die Content-Security-Policy aus §3.2', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe');
  });

  it('lehnt jede Berechtigungsanfrage ab', () => {
    for (const permission of ['media', 'notifications', 'geolocation', 'clipboard-read']) {
      let granted: boolean | null = null;
      permissionRequestHandler(null, permission, (value) => (granted = value));
      expect(granted).toBe(false);
    }
  });

  it('erlaubt Navigation nur im App-Ursprung', () => {
    expect(isNavigationAllowed('app://app/index.html', undefined)).toBe(true);
    expect(isNavigationAllowed('https://example.com/', undefined)).toBe(false);
    expect(isNavigationAllowed('file:///C:/x.html', undefined)).toBe(false);
    expect(isNavigationAllowed('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
  });

  it('legt die Fuses fest und hält sie mit dem Build-Skript gleich', () => {
    expect(FUSE_POLICY).toEqual({ runAsNode: false, enableNodeCliInspectArguments: false, enableNodeOptionsEnvironmentVariable: false, onlyLoadAppFromAsar: true });
    expect(FUSES).toEqual(FUSE_POLICY);
  });
});

describe('Protokoll app:// (AK-10-03)', () => {
  let root: string;
  let renderer: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ipa-proto-'));
    renderer = path.join(root, 'renderer');
    await mkdir(path.join(renderer, 'assets'), { recursive: true });
    await writeFile(path.join(renderer, 'index.html'), '<!doctype html><title>x</title>');
    await writeFile(path.join(renderer, 'assets', 'app.js'), 'console.log(1)');
    await writeFile(path.join(root, 'geheim.txt'), 'nicht ausliefern');
    try {
      await symlink(path.join(root, 'geheim.txt'), path.join(renderer, 'link.txt'), 'file');
    } catch {
      // Symbolic links need rights on Windows; the traversal checks below cover the rest.
    }
  });
  afterAll(async () => rm(root, { recursive: true, force: true }));

  const get = (url: string) => createAppProtocolHandler(renderer)(new Request(url));

  it('liefert Dateien mit CSP, Inhaltstyp und nosniff', async () => {
    const page = await get('app://app/index.html');
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(page.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await get('app://app/')).status).toBe(200);
    expect((await get('app://app/assets/app.js')).headers.get('Content-Type')).toContain('text/javascript');
  });

  it('antwortet 404 für fehlende Dateien, Pfade ausserhalb und Verweise nach aussen', async () => {
    expect((await get('app://app/fehlt.js')).status).toBe(404);
    expect((await get('app://app/..%2Fgeheim.txt')).status).toBe(404);
    expect((await get('app://app/%2e%2e/geheim.txt')).status).toBe(404);
    expect((await get('app://app/assets/..%5C..%5Cgeheim.txt')).status).toBe(404);
    expect((await get('app://app/link.txt')).status).not.toBe(200);
    const missing = await get('app://app/fehlt.js');
    expect(missing.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
  });
});

/**
 * VERBATIM port of `buildContentSecurityPolicy` from the host repo, copied so
 * the spike stamps the exact production CSP without needing a TypeScript
 * loader for a cross-repo import (this harness runs as a plain `.mjs` under
 * `npx electron`, task 1.2).
 *
 * Source: `HOST_WT/packages/desktop/app/main/utils/csp.ts`
 *   - TRUSTED_CDN_DOMAINS ............ lines 6-9
 *   - DEFAULT_IMG_SRC ................ lines 14-15
 *   - DEFAULT_MEDIA_SRC .............. line 16
 *   - DEFAULT_FONT_SRC ............... line 17
 *   - DEFAULT_STYLE_SRC .............. line 18
 *   - "plugin: is script-src ONLY" comment ... lines 19-33 (see below,
 *     reproduced because it is the exact policy this spike is testing)
 *   - DEFAULT_SCRIPT_SRC ............. line 35
 *   - DEFAULT_WORKER_SRC ............. line 36
 *   - DEFAULT_FRAME_SRC .............. line 46
 *   - DEFAULT_OBJECT_SRC ............. line 47
 *   - DEFAULT_DEFAULT_SRC ............ line 48
 *   - DEFAULT_BASE_URI ............... line 49
 *   - DEFAULT_FORM_ACTION ............ line 50
 *   - DEFAULT_FRAME_ANCESTORS ........ line 51
 *   - buildContentSecurityPolicy() ... lines 60-77
 *
 * DO NOT hand-edit the string bodies below without re-diffing against the
 * source file — this file's entire value is being a faithful copy.
 *
 * Reproduced verbatim (csp.ts:21-27), because it is the exact claim item ①
 * measures:
 *   `plugin:` is the ONE token OpenSpec `plugin-protocol-trust` (H1) adds, and
 *   it is added to `script-src` ONLY (no other directive). A renderer dynamic
 *   `import('plugin://…')` and its statically-imported sibling chunks are
 *   `script-src` decisions (Chromium treats ES-module fetches as script);
 *   module loading does NOT consult connect-src / worker-src / style-src /
 *   default-src, and a plugin's asset fetches route through the host IPC
 *   bridge (Child I), not renderer network — so NO other directive gains
 *   `plugin:`.
 */

const TRUSTED_CDN_DOMAINS = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
];

const DEFAULT_IMG_SRC =
  "img-src 'self' data: blob: https: http: file: wallpaper: media: resource: app:";
const DEFAULT_MEDIA_SRC = "media-src 'self' data: blob: https: http: file: media: resource: app:";
const DEFAULT_FONT_SRC = "font-src 'self' https: data:";
const DEFAULT_STYLE_SRC = "style-src 'self' 'unsafe-inline' https:";
const DEFAULT_SCRIPT_SRC = `script-src 'self' 'unsafe-inline' 'unsafe-eval' plugin: ${TRUSTED_CDN_DOMAINS.join(' ')}`;
const DEFAULT_WORKER_SRC = `worker-src 'self' blob: ${TRUSTED_CDN_DOMAINS.join(' ')}`;
const DEFAULT_FRAME_SRC = "frame-src 'self' blob: https: http://127.0.0.1 http://localhost";
const DEFAULT_OBJECT_SRC = "object-src 'none'";
const DEFAULT_DEFAULT_SRC = "default-src 'self'";
const DEFAULT_BASE_URI = "base-uri 'self'";
const DEFAULT_FORM_ACTION = "form-action 'self'";
const DEFAULT_FRAME_ANCESTORS = "frame-ancestors 'none'";

export function buildContentSecurityPolicy(connectSources = []) {
  const connectSet = new Set(["'self'", ...connectSources.filter(Boolean)]);
  return [
    DEFAULT_DEFAULT_SRC,
    DEFAULT_SCRIPT_SRC,
    DEFAULT_STYLE_SRC,
    DEFAULT_IMG_SRC,
    DEFAULT_MEDIA_SRC,
    `connect-src ${Array.from(connectSet).join(' ')}`,
    DEFAULT_FONT_SRC,
    DEFAULT_FRAME_SRC,
    DEFAULT_WORKER_SRC,
    DEFAULT_OBJECT_SRC,
    DEFAULT_BASE_URI,
    DEFAULT_FORM_ACTION,
    DEFAULT_FRAME_ANCESTORS,
  ].join('; ');
}

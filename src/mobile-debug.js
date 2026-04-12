/**
 * Mobile / Chrome crash diagnostics: on-screen ring buffer + global hooks.
 * Enable: add ?debug=1 or ?kolbashDebug=1 to URL, or localStorage.setItem('kolbash_debug_mobile','1') then reload.
 * Last ~60 log lines are mirrored to sessionStorage (kolbash_debug_crash_tail) on heartbeat, hide, unload —
 * shown as PREV_LOG_TAIL after a reload so sudden kills still leave a breadcrumb trail.
 */

const LS_KEY = 'kolbash_debug_mobile';
const SS_TAIL_KEY = 'kolbash_debug_crash_tail';
const MAX_LINES = 280;

function debugEnabled() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const q = new URLSearchParams(window.location.search);
    if (q.get('debug') === '1' || q.get('kolbashDebug') === '1') return true;
    return window.localStorage?.getItem(LS_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function ts() {
  const t = performance.now();
  const d = new Date();
  return `${d.toISOString().slice(11, 23)} +${t.toFixed(0)}ms`;
}

function memSnippet() {
  try {
    const p = performance;
    if (p && p.memory) {
      const u = (p.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
      const l = (p.memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(1);
      return `heap ${u}/${l}MB`;
    }
  } catch (e) {}
  return '';
}

function envSnippet() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const dm = nav.deviceMemory;
    const hc = nav.hardwareConcurrency;
    const ua = typeof nav.userAgent === 'string' ? nav.userAgent.slice(0, 120) : '';
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : '';
    const w = typeof window !== 'undefined' ? window.innerWidth : '';
    const h = typeof window !== 'undefined' ? window.innerHeight : '';
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    const eff = conn?.effectiveType || conn?.type || '';
    return `dm=${dm ?? '?'} hc=${hc ?? '?'} dpr=${dpr} ${w}x${h} net=${eff} ${ua}`;
  } catch (e) {
    return '';
  }
}

/**
 * @param {(s: string) => void} appendLine append full line text (no extra timestamp)
 */
function readPrevTail(appendLine) {
  try {
    const raw = sessionStorage.getItem(SS_TAIL_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    const arr = o?.lines;
    if (!Array.isArray(arr) || !arr.length) return;
    const when = o.t ? new Date(o.t).toISOString() : '?';
    appendLine(`[replay] --- PREV_LOG_TAIL saved ${when} (${arr.length} lines) ---`);
    for (const row of arr) appendLine(String(row).slice(0, 2000));
    appendLine('[replay] --- END PREV_LOG_TAIL ---');
  } catch (e) {}
}

function writeTail(lines) {
  try {
    const tail = lines.slice(-60);
    sessionStorage.setItem(SS_TAIL_KEY, JSON.stringify({ t: Date.now(), lines: tail }));
  } catch (e) {}
}

function rendererSnippet(renderer) {
  if (!renderer?.info) return '';
  try {
    const i = renderer.info;
    const r = i.render;
    const m = i.memory;
    const parts = [];
    if (r) parts.push(`tri=${r.triangles ?? 0} calls=${r.calls ?? 0}`);
    if (m) parts.push(`geom=${m.geometries ?? 0} tex=${m.textures ?? 0}`);
    return parts.join(' ');
  } catch (e) {
    return '';
  }
}

/**
 * @param {object} ctx
 * @param {() => unknown | null} [ctx.getGame] returns Game instance
 */
export function attachMobileDebug(ctx = {}) {
  if (!debugEnabled()) {
    return null;
  }

  const getGame = typeof ctx.getGame === 'function' ? ctx.getGame : () => null;

  const lines = [];
  let flushScheduled = false;
  const scheduleFlushTail = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      writeTail(lines);
    });
  };

  const appendLine = (line) => {
    lines.push(line);
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    if (panelText) panelText.textContent = lines.join('\n');
    if (panel) panel.scrollTop = panel.scrollHeight;
    scheduleFlushTail();
  };

  const push = (msg) => {
    const line = `[${ts()}] ${msg}`;
    appendLine(line);
    try {
      console.warn('[KOLBASH:DBG]', line, memSnippet());
    } catch (e) {}
  };

  let panel = null;
  let panelText = null;

  const host = document.createElement('div');
  host.id = 'kolbash-mobile-debug';
  host.setAttribute('aria-live', 'polite');
  host.style.cssText = [
    'position:fixed',
    'left:4px',
    'right:4px',
    'bottom:4px',
    'max-height:32vh',
    'z-index:2147483000',
    'display:flex',
    'flex-direction:column',
    'gap:4px',
    'font:10px/1.25 ui-monospace,monospace',
    'color:#9f9',
    'pointer-events:auto',
    'touch-action:manipulation'
  ].join(';');

  const bar = document.createElement('div');
  bar.style.cssText =
    'display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:rgba(0,0,0,.88);padding:4px 6px;border:1px solid #244;';
  const title = document.createElement('span');
  title.textContent = 'KOLBASH DEBUG';
  title.style.cssText = 'color:#6cf;font-weight:700;';
  const btnCopy = document.createElement('button');
  btnCopy.type = 'button';
  btnCopy.textContent = 'Copy log';
  btnCopy.style.cssText =
    'font:inherit;padding:2px 8px;border:1px solid #555;background:#222;color:#ddd;border-radius:3px;';
  const btnClr = document.createElement('button');
  btnClr.type = 'button';
  btnClr.textContent = 'Clear';
  btnClr.style.cssText = btnCopy.style.cssText;
  const btnHide = document.createElement('button');
  btnHide.type = 'button';
  btnHide.textContent = 'Hide';
  btnHide.style.cssText = btnCopy.style.cssText;

  panel = document.createElement('pre');
  panelText = document.createElement('span');
  panel.appendChild(panelText);
  panel.style.cssText =
    'margin:0;flex:1;overflow:auto;white-space:pre-wrap;word-break:break-word;background:rgba(0,10,0,.9);border:1px solid #363;padding:6px;max-height:28vh;';

  bar.appendChild(title);
  bar.appendChild(btnCopy);
  bar.appendChild(btnClr);
  bar.appendChild(btnHide);
  host.appendChild(bar);
  host.appendChild(panel);
  document.body.appendChild(host);

  readPrevTail(appendLine);
  push(`DEBUG ON ${envSnippet()}`);
  push('(disable: remove ?debug=1 and localStorage kolbash_debug_mobile)');

  btnClr.addEventListener('click', () => {
    lines.length = 0;
    panelText.textContent = '';
  });
  btnHide.addEventListener('click', () => {
    host.style.display = 'none';
  });
  btnCopy.addEventListener('click', async () => {
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      push('CLIPBOARD: copied');
    } catch (e) {
      push(`CLIPBOARD FAIL ${e?.message || e}`);
    }
  });

  const onErr = (ev) => {
    const m = ev?.message || ev?.error?.message || String(ev?.error || ev);
    const stack = ev?.error?.stack ? ` ${ev.error.stack.slice(0, 600)}` : '';
    push(`ERROR ${m}${stack}`);
  };
  const onRej = (ev) => {
    const r = ev?.reason;
    const m = r?.message || (typeof r === 'string' ? r : String(r));
    const stack = r?.stack ? ` ${r.stack.slice(0, 600)}` : '';
    push(`UNHANDLED_REJECTION ${m}${stack}`);
  };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onRej);

  const onVis = () => {
    push(`VISIBILITY hidden=${document.hidden}`);
    if (document.hidden) writeTail(lines);
  };
  document.addEventListener('visibilitychange', onVis);

  const onBeforeUnload = () => {
    push('BEFOREUNLOAD');
    writeTail(lines);
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  const onOnline = () => push('ONLINE');
  const onOffline = () => push('OFFLINE');
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const onPageHide = (e) => {
    push(`PAGEHIDE persisted=${e.persisted}`);
    writeTail(lines);
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', (e) => {
    push(`PAGESHOW persisted=${e.persisted}`);
  });

  const onFreeze = () => push('FREEZE (page lifecycle)');
  const onResume = () => push('RESUME (page lifecycle)');
  try {
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
  } catch (e) {}

  let lastGlCanvas = null;
  const onWebglCtxLost = (e) => {
    push(`WEBGL_CONTEXT_LOST status=${e.statusMessage || 'n/a'}`);
  };
  const onWebglCtxRestored = () => {
    push('WEBGL_CONTEXT_RESTORED (state may be invalid — prefer full reload)');
  };
  const bindCanvas = () => {
    const g = getGame();
    const canvas = g?.renderer?.domElement;
    if (!canvas) return;
    if (canvas === lastGlCanvas) return;
    if (lastGlCanvas) {
      lastGlCanvas.removeEventListener('webglcontextlost', onWebglCtxLost);
      lastGlCanvas.removeEventListener('webglcontextrestored', onWebglCtxRestored);
    }
    lastGlCanvas = canvas;
    canvas.addEventListener('webglcontextlost', onWebglCtxLost, false);
    canvas.addEventListener('webglcontextrestored', onWebglCtxRestored, false);
    push('WEBGL canvas listeners bound');
  };

  let lastSpikeLog = 0;
  const tickFrame = (deltaMs) => {
    const now = performance.now();
    if (deltaMs > 120 && now - lastSpikeLog > 2000) {
      lastSpikeLog = now;
      const g = getGame();
      push(`FRAME_SPIKE deltaMs=${deltaMs.toFixed(0)} ${memSnippet()} ${rendererSnippet(g?.renderer)}`);
    }
  };

  let iv = setInterval(() => {
    bindCanvas();
    const g = getGame();
    const m = memSnippet();
    const r = rendererSnippet(g?.renderer);
    const run = g?.isRunning;
    const wave = g?.waveManager?.currentWave;
    const lvl = g?.arena?.currentLevel;
    const sp = g?.specialAttackActive;
    const gl = g?._glContextLost;
    push(`HB run=${run} wave=${wave} lvl=${lvl} spec=${sp} glLost=${gl} ${m} ${r}`);
    writeTail(lines);
  }, 4000);

  const api = {
    log(msg) {
      push(String(msg));
    },
    mark(tag, detail = '') {
      push(`${tag} ${detail}`);
    },
    tickFrame,
    dispose() {
      clearInterval(iv);
      iv = 0;
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVis);
      try {
        document.removeEventListener('freeze', onFreeze);
        document.removeEventListener('resume', onResume);
      } catch (e) {}
      if (lastGlCanvas) {
        lastGlCanvas.removeEventListener('webglcontextlost', onWebglCtxLost);
        lastGlCanvas.removeEventListener('webglcontextrestored', onWebglCtxRestored);
        lastGlCanvas = null;
      }
      host.remove();
    },
    getLines: () => [...lines]
  };

  window.__KOLBASH_DEBUG__ = api;
  push('window.__KOLBASH_DEBUG__ = { log, mark, getLines, dispose }');

  bindCanvas();
  return api;
}

export { debugEnabled, LS_KEY };

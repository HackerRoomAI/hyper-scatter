#!/usr/bin/env npx tsx
/**
 * Demo Interaction Benchmark Runner
 *
 * Drives the real demo page (index.html) with Puppeteer and measures perceived FPS
 * while:
 *  - Panning aggressively towards the edges (Poincaré disk boundary / canvas edges)
 *  - Hovering (mousemove triggering hitTest + render)
 *
 * This is intended to match real user interaction more closely than benchmark.html.
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

function getNpxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

async function stopDevServer(proc: ChildProcess): Promise<void> {
  if (proc.killed) return;
  try {
    if (process.platform !== 'win32' && proc.pid) {
      try {
        process.kill(-proc.pid, 'SIGTERM');
      } catch {
        proc.kill('SIGTERM');
      }
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    // ignore
  }

  try {
    if (process.platform !== 'win32' && proc.pid) {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {
        proc.kill('SIGKILL');
      }
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    // ignore
  }
}

interface Config {
  headless: boolean;
  dpr: number;
  width: number;
  height: number;
  geometry: 'euclidean' | 'poincare';
  points: number;
  // Duration per phase (ms)
  panMs: number;
  hoverMs: number;
  screenshot?: string;
}

const DEFAULTS: Config = {
  headless: false,
  dpr: 2,
  width: 1800,
  height: 1100,
  geometry: 'poincare',
  points: 1_000_000,
  panMs: 5000,
  hoverMs: 5000,
};

function parseArgs(): Partial<Config> {
  const args: Partial<Config> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--headless') args.headless = true;
    else if (arg === '--headed' || arg === '--no-headless') args.headless = false;
    else if (arg.startsWith('--dpr=')) {
      const v = Number(arg.slice('--dpr='.length));
      if (Number.isFinite(v) && v > 0) args.dpr = v;
    } else if (arg.startsWith('--width=')) {
      const v = Number(arg.slice('--width='.length));
      if (Number.isFinite(v) && v > 0) args.width = v;
    } else if (arg.startsWith('--height=')) {
      const v = Number(arg.slice('--height='.length));
      if (Number.isFinite(v) && v > 0) args.height = v;
    } else if (arg.startsWith('--geometry=')) {
      const v = arg.slice('--geometry='.length);
      if (v === 'euclidean' || v === 'poincare') args.geometry = v;
    } else if (arg.startsWith('--points=')) {
      const v = Number(arg.slice('--points='.length));
      if (Number.isFinite(v) && v > 0) args.points = v;
    } else if (arg.startsWith('--panMs=')) {
      const v = Number(arg.slice('--panMs='.length));
      if (Number.isFinite(v) && v > 0) args.panMs = v;
    } else if (arg.startsWith('--hoverMs=')) {
      const v = Number(arg.slice('--hoverMs='.length));
      if (Number.isFinite(v) && v > 0) args.hoverMs = v;
    } else if (arg.startsWith('--screenshot=')) {
      const v = arg.slice('--screenshot='.length).trim();
      if (v) args.screenshot = v;
    }
  }
  return args;
}

async function maybeCaptureScreenshot(page: Page, cfg: Config, label: string): Promise<void> {
  if (!cfg.screenshot) return;

  const base = cfg.screenshot;
  const path = base.includes('.')
    ? base.replace(/\.png$/i, `-${label}.png`)
    : `${base}-${label}.png`;

  mkdirSync(dirname(path), { recursive: true });

  // Try to capture the canvas container; fall back to full page.
  const el = await page.$('#canvasBody');
  if (el) {
    await el.screenshot({ path });
  } else {
    await page.screenshot({ path, fullPage: true });
  }
  console.log(`[Demo Interaction Bench] Saved screenshot: ${path}`);
}

async function startDevServer(): Promise<{ proc: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getNpxCommand(), ['vite', '--port', '5174', '--strictPort'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
    });

    let resolved = false;
    const timeoutId = global.setTimeout(() => {
      if (!resolved) reject(new Error('Dev server startup timeout'));
    }, 30000);

    const checkForUrl = (text: string) => {
      const match = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve({ proc, url: match[1] });
      }
    };

    proc.stdout?.on('data', (data: Buffer) => checkForUrl(data.toString()));
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      checkForUrl(text);
      if (text.includes('error') || text.includes('Error')) {
        console.error('Dev server error:', text);
      }
    });

    proc.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeoutId);
        reject(err);
      }
    });
  });
}

async function installFpsProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__fpsProbe = {
      running: false,
      last: 0,
      intervals: [] as number[],
      handle: 0 as number,
      start() {
        this.running = true;
        this.last = 0;
        this.intervals = [];
        const loop = (ts: number) => {
          if (!this.running) return;
          if (this.last !== 0) {
            this.intervals.push(ts - this.last);
            if (this.intervals.length > 2000) this.intervals.shift();
          }
          this.last = ts;
          this.handle = requestAnimationFrame(loop);
        };
        this.handle = requestAnimationFrame(loop);
      },
      stop() {
        this.running = false;
        if (this.handle) cancelAnimationFrame(this.handle);
      },
      stats() {
        const xs = this.intervals.slice().sort((a: number, b: number) => a - b);
        const n = xs.length;
        const avg = n ? xs.reduce((s: number, v: number) => s + v, 0) / n : 0;
        const median = n ? xs[Math.floor(n / 2)] : 0;
        const p95 = n ? xs[Math.floor(n * 0.95)] : 0;
        return {
          samples: n,
          avgMs: avg,
          medianMs: median,
          p95Ms: p95,
          fpsAvg: avg > 0 ? 1000 / avg : 0,
          fpsMedian: median > 0 ? 1000 / median : 0,
        };
      },
    };
  });
}

async function setDemoControls(page: Page, cfg: Config): Promise<void> {
  // Select renderer/geometry/points.
  await page.select('#renderer', 'webgl');
  await page.select('#geometry', cfg.geometry);
  await page.select('#numPoints', String(cfg.points));

  // Click generate.
  await page.click('#generateBtn');

  // Wait for statPoints to update to the selected N.
  const expected = cfg.points.toLocaleString();
  await page.waitForFunction(
    (exp: string) => {
      const el = document.getElementById('statPoints');
      return !!el && (el.textContent || '').includes(exp);
    },
    { timeout: 120000 },
    expected
  );

  // Give the app a beat to finish uploading buffers.
  await sleep(250);
}

async function getCanvasRect(page: Page): Promise<{ left: number; top: number; width: number; height: number }>
{
  return page.$eval('#canvas', (el) => {
    const r = (el as HTMLCanvasElement).getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

async function measurePhase(page: Page, label: string, run: () => Promise<void>): Promise<any> {
  await page.evaluate(() => (window as any).__fpsProbe.start());
  await run();
  await page.evaluate(() => (window as any).__fpsProbe.stop());
  const stats = await page.evaluate(() => (window as any).__fpsProbe.stats());
  return { label, ...stats };
}

async function runPanToEdges(page: Page, cfg: Config): Promise<void> {
  const panViews = await page.evaluate(async (params: { geometry: 'euclidean' | 'poincare'; durationMs: number }) => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('Canvas not found');
    const rect = canvas.getBoundingClientRect();

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const diskRadius = Math.min(rect.width, rect.height) * 0.45;
    const amp = params.geometry === 'poincare'
      ? diskRadius * 0.92
      : Math.min(rect.width, rect.height) * 0.45;

    // One-way drag: center -> near right boundary.
    // This matches the typical user action (drag and release) and avoids
    // returning to the start which can legitimately cancel out the net pan.
    const keypoints = [
      { x: cx, y: cy },
      { x: cx + amp, y: cy },
    ];

    const dispatch = (type: string, x: number, y: number, buttons: number) => {
      const ev = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        buttons,
      });
      canvas.dispatchEvent(ev);
    };

    // Start drag at center.
    dispatch('mousedown', cx, cy, 1);

    const readView = () => (window as any).__vizDemo?.getView?.() ?? null;
    const startView = readView();
    let midView: any = null;
    let endView: any = null;

    const segs = keypoints.length - 1;
    const start = performance.now();

    await new Promise<void>((resolve) => {
      const step = () => {
        const now = performance.now();
        const t = Math.min(1, (now - start) / Math.max(1, params.durationMs));

        const sFloat = t * segs;
        const s = Math.min(segs - 1, Math.floor(sFloat));
        const u = sFloat - s;

        const a = keypoints[s];
        const b = keypoints[s + 1];
        const x = a.x + (b.x - a.x) * u;
        const y = a.y + (b.y - a.y) * u;

        dispatch('mousemove', x, y, 1);

        if (!midView && t >= 0.5) {
          midView = readView();
        }

        if (t >= 1) {
          dispatch('mouseup', x, y, 0);
          // Give the app a chance to flush pending pan in the mouseup handler
          // and/or a following rAF.
          requestAnimationFrame(() => {
            endView = readView();
            resolve();
          });
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    return { startView, midView, endView };
  }, { geometry: cfg.geometry, durationMs: cfg.panMs });

  // Attach for later printing.
  (runPanToEdges as any).__lastViews = panViews;
}

async function runHoverPath(page: Page, cfg: Config): Promise<void> {
  await page.evaluate(async (params: { durationMs: number }) => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('Canvas not found');
    const rect = canvas.getBoundingClientRect();

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * 0.25;

    const dispatch = (x: number, y: number) => {
      const ev = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        buttons: 0,
      });
      canvas.dispatchEvent(ev);
    };

    const start = performance.now();

    await new Promise<void>((resolve) => {
      const step = () => {
        const now = performance.now();
        const t = Math.min(1, (now - start) / Math.max(1, params.durationMs));
        const ang = t * Math.PI * 2;
        const x = cx + Math.cos(ang) * radius;
        const y = cy + Math.sin(ang) * radius;
        dispatch(x, y);

        if (t >= 1) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { durationMs: cfg.hoverMs });
}

async function main() {
  const cfg: Config = { ...DEFAULTS, ...parseArgs() };

  console.log('[Demo Interaction Bench] Starting...');
  console.log(`  Geometry: ${cfg.geometry}`);
  console.log(`  Points:   ${cfg.points.toLocaleString()}`);
  console.log(`  DPR:      ${cfg.dpr}`);
  console.log(`  Viewport: ${cfg.width}x${cfg.height}`);
  console.log(`  Pan:      ${cfg.panMs}ms`);
  console.log(`  Hover:    ${cfg.hoverMs}ms`);
  console.log('');

  let dev: { proc: ChildProcess; url: string } | null = null;
  let browser: Browser | null = null;

  try {
    console.log('[1/4] Starting dev server...');
    dev = await startDevServer();
    console.log(`  Dev server running at ${dev.url}`);

    console.log('[2/4] Launching browser...');
    browser = await puppeteer.launch({
      headless: cfg.headless,
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: cfg.width, height: cfg.height, deviceScaleFactor: cfg.dpr });

    console.log('[3/4] Loading demo page...');
    await page.goto(dev.url + '/', { waitUntil: 'networkidle2', timeout: 120000 });
    await page.bringToFront();

    // tsx/esbuild may wrap serialized functions passed to page.evaluate() with
    // __name(...) calls. Define a no-op __name helper in the page to prevent
    // ReferenceError: __name is not defined.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page as any).evaluateOnNewDocument('globalThis.__name = (fn) => fn;');
    } catch {
      await page.evaluate('globalThis.__name = (fn) => fn;');
    }

    await installFpsProbe(page);

    console.log('[4/4] Generating dataset + running interaction phases...');
    await setDemoControls(page, cfg);
    await maybeCaptureScreenshot(page, cfg, 'after-generate');

    const viewBefore = await page.evaluate(() => (window as any).__vizDemo?.getView?.() ?? null);

    const idleStats = await measurePhase(page, 'idle', async () => { await sleep(2000); });
    const panStats = await measurePhase(page, 'panToEdges', async () => runPanToEdges(page, cfg));
    await maybeCaptureScreenshot(page, cfg, 'after-pan');
    const viewAfterPan = await page.evaluate(() => (window as any).__vizDemo?.getView?.() ?? null);
    const policyAfterPan = await page.evaluate(() => (window as any).__vizDemo?.getRenderer?.()?.__debugPolicy ?? null);
    const panPhaseViews = (runPanToEdges as any).__lastViews ?? null;
    const hoverStats = await measurePhase(page, 'hover', async () => runHoverPath(page, cfg));
    await maybeCaptureScreenshot(page, cfg, 'after-hover');
    const viewAfterHover = await page.evaluate(() => (window as any).__vizDemo?.getView?.() ?? null);
    const policyAfterHover = await page.evaluate(() => (window as any).__vizDemo?.getRenderer?.()?.__debugPolicy ?? null);

    const sys = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      canvas: (() => {
        const c = document.getElementById('canvas') as HTMLCanvasElement | null;
        if (!c) return null;
        return {
          cssWidth: c.clientWidth,
          cssHeight: c.clientHeight,
          bufWidth: c.width,
          bufHeight: c.height,
        };
      })(),
      statFrameTime: (document.getElementById('statFrameTime')?.textContent ?? ''),
    }));

    const pretty = (s: any) =>
      `${s.label.padEnd(10)} | samples=${String(s.samples).padStart(5)} | avg=${s.avgMs.toFixed(2)}ms (${s.fpsAvg.toFixed(1)} fps) | p95=${s.p95Ms.toFixed(2)}ms`;

    console.log('');
    console.log('════════════════════════════════════════════════════════════════════');
    console.log('DEMO INTERACTION RESULTS');
    console.log('════════════════════════════════════════════════════════════════════');
    console.log(`UserAgent: ${String(sys.userAgent).slice(0, 90)}...`);
    console.log(`Window DPR: ${sys.devicePixelRatio}`);
    console.log(`Canvas: css=${sys.canvas?.cssWidth}x${sys.canvas?.cssHeight}, buffer=${sys.canvas?.bufWidth}x${sys.canvas?.bufHeight}`);
    console.log(`Demo statFrameTime: ${sys.statFrameTime}`);
    console.log('────────────────────────────────────────────────────────────────────');
    console.log(pretty(idleStats));
    console.log(pretty(panStats));
    console.log(pretty(hoverStats));
    console.log('────────────────────────────────────────────────────────────────────');
    console.log('View before pan:', JSON.stringify(viewBefore));
    console.log('View after pan:', JSON.stringify(viewAfterPan));
    console.log('Policy after pan:', JSON.stringify(policyAfterPan));
    console.log('Pan phase views:', JSON.stringify(panPhaseViews));
    console.log('View after hover:', JSON.stringify(viewAfterHover));
    console.log('Policy after hover:', JSON.stringify(policyAfterHover));
    console.log('════════════════════════════════════════════════════════════════════');
    console.log('');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (dev?.proc) await stopDevServer(dev.proc);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

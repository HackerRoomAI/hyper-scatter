#!/usr/bin/env npx tsx
/**
 * Capture Poincaré Disk Interaction GIF
 * 
 * Creates a smooth, aesthetic GIF showing pan and zoom interactions
 * in the Poincaré disk visualization.
 * 
 * Usage:
 *   npx tsx docs/capture-poincare-gif.ts
 * 
 * Then run ffmpeg to create the GIF (command printed at end).
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  viewport: { width: 1000, height: 700 },
  framesDir: 'docs/poincare_gif_frames',
  outputGif: 'docs/poincare_demo.gif',
  frameRate: 24,         // frames per second (24 is cinematic)
  totalDuration: 7,      // seconds (slightly longer for more panning)
  frameDelayMs: 50,      // delay between frames for smooth capture
};

// ============================================================================
// Dev Server Management
// ============================================================================

function getNpxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 304);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function startDevServer(): Promise<{ proc: ChildProcess | null; url: string }> {
  // Check if dev server is already running on common ports
  const existingPorts = [5173, 5174, 5175, 5176];
  for (const port of existingPorts) {
    if (await checkPort(port)) {
      console.log(`   Found existing dev server on port ${port}`);
      return { proc: null, url: `http://localhost:${port}` };
    }
  }
  
  // Start our own server
  return new Promise((resolve, reject) => {
    const proc = spawn(getNpxCommand(), ['vite', '--port', '5176', '--strictPort'], {
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
    proc.stderr?.on('data', (data: Buffer) => checkForUrl(data.toString()));
    proc.on('error', (err) => {
      if (!resolved) { clearTimeout(timeoutId); reject(err); }
    });
  });
}

async function stopDevServer(proc: ChildProcess): Promise<void> {
  if (proc.killed) return;
  try {
    if (process.platform !== 'win32' && proc.pid) {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* ignore */ }
}

// ============================================================================
// Easing Functions
// ============================================================================

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// ============================================================================
// Animation Definition
// ============================================================================

interface Segment {
  type: 'wait' | 'pan' | 'zoom';
  duration: number;  // as fraction of total time
  dx?: number;       // For pan: relative movement (canvas-relative, 0-1)
  dy?: number;
  delta?: number;    // For zoom: total scroll delta (negative = zoom in)
  cx?: number;       // Center point for zoom (canvas-relative, 0-1)
  cy?: number;
}

const ANIMATION: Segment[] = [
  // Initial pause (show full Poincaré disk)
  { type: 'wait', duration: 0.06 },
  
  // === ZOOMED OUT PANNING (most impressive - shows geodesic motion!) ===
  // Big sweeping pan across the disk
  { type: 'pan', duration: 0.14, dx: 0.25, dy: 0.12 },
  
  // Pan back the other way
  { type: 'pan', duration: 0.14, dx: -0.30, dy: 0.08 },
  
  // Diagonal pan
  { type: 'pan', duration: 0.12, dx: 0.15, dy: -0.20 },
  
  // Brief pause
  { type: 'wait', duration: 0.04 },
  
  // === ZOOM IN to show detail ===
  { type: 'zoom', duration: 0.12, delta: -600, cx: 0.55, cy: 0.45 },
  
  // Small pan while zoomed
  { type: 'pan', duration: 0.08, dx: 0.08, dy: 0.05 },
  
  // === ZOOM BACK OUT ===
  { type: 'zoom', duration: 0.10, delta: 700, cx: 0.5, cy: 0.5 },
  
  // === MORE ZOOMED OUT PANNING ===
  // Another big sweep to show off the hyperbolic motion
  { type: 'pan', duration: 0.12, dx: -0.20, dy: -0.15 },
  
  // Final pan back toward center
  { type: 'pan', duration: 0.08, dx: 0.10, dy: 0.08 },
  
  // Final pause
  { type: 'wait', duration: 0.04 },
];

// ============================================================================
// Frame Capture
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function captureFrames(page: Page): Promise<void> {
  const totalFrames = CONFIG.frameRate * CONFIG.totalDuration;
  
  console.log(`Capturing ${totalFrames} frames at ${CONFIG.frameRate} fps...`);
  
  // Get canvas bounding box
  const canvasBox = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  
  if (!canvasBox) {
    throw new Error('Canvas not found');
  }
  
  console.log(`Canvas: ${canvasBox.width}x${canvasBox.height} at (${canvasBox.x}, ${canvasBox.y})`);
  
  // Normalize durations
  let totalDuration = 0;
  for (const seg of ANIMATION) totalDuration += seg.duration;
  const normalizedSegments = ANIMATION.map(seg => ({
    ...seg,
    duration: seg.duration / totalDuration,
  }));
  
  function getFrameState(frameT: number): { segmentIndex: number; segmentProgress: number } {
    let accumulated = 0;
    for (let i = 0; i < normalizedSegments.length; i++) {
      const seg = normalizedSegments[i];
      if (frameT <= accumulated + seg.duration) {
        return {
          segmentIndex: i,
          segmentProgress: (frameT - accumulated) / seg.duration,
        };
      }
      accumulated += seg.duration;
    }
    return { segmentIndex: normalizedSegments.length - 1, segmentProgress: 1 };
  }
  
  // Track mouse state
  let mouseX = canvasBox.x + canvasBox.width / 2;
  let mouseY = canvasBox.y + canvasBox.height / 2;
  let isPanning = false;
  let currentSegmentIndex = -1;
  let panStartX = 0;
  let panStartY = 0;
  
  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / (totalFrames - 1);
    const { segmentIndex, segmentProgress } = getFrameState(t);
    const segment = normalizedSegments[segmentIndex];
    const easedProgress = easeInOutSine(segmentProgress);
    
    // Detect segment change
    const segmentChanged = segmentIndex !== currentSegmentIndex;
    if (segmentChanged) {
      if (isPanning) {
        await page.mouse.up();
        isPanning = false;
      }
      currentSegmentIndex = segmentIndex;
      
      if (segment.type === 'pan') {
        panStartX = mouseX;
        panStartY = mouseY;
        await page.mouse.move(mouseX, mouseY);
        await page.mouse.down();
        isPanning = true;
      } else if (segment.type === 'zoom') {
        mouseX = canvasBox.x + (segment.cx ?? 0.5) * canvasBox.width;
        mouseY = canvasBox.y + (segment.cy ?? 0.5) * canvasBox.height;
        await page.mouse.move(mouseX, mouseY);
      }
    }
    
    // Execute segment action
    if (segment.type === 'pan' && isPanning) {
      const targetX = panStartX + (segment.dx ?? 0) * canvasBox.width * easedProgress;
      const targetY = panStartY + (segment.dy ?? 0) * canvasBox.height * easedProgress;
      await page.mouse.move(targetX, targetY);
      mouseX = targetX;
      mouseY = targetY;
    } else if (segment.type === 'zoom') {
      const segmentFrames = Math.ceil(segment.duration * totalFrames);
      const scrollPerFrame = (segment.delta ?? 0) / segmentFrames;
      if (Math.abs(scrollPerFrame) > 0.1) {
        await page.mouse.wheel({ deltaY: scrollPerFrame });
      }
    }
    
    // Wait for render
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(undefined))));
    await sleep(CONFIG.frameDelayMs);
    
    // Capture frame
    const framePath = path.join(CONFIG.framesDir, `frame_${String(frame).padStart(4, '0')}.png`);
    
    await page.screenshot({
      path: framePath,
      clip: {
        x: canvasBox.x,
        y: canvasBox.y,
        width: canvasBox.width,
        height: canvasBox.height,
      },
    });
    
    if (frame % 24 === 0 || frame === totalFrames - 1) {
      console.log(`  Frame ${frame + 1}/${totalFrames} (${Math.round(t * 100)}%)`);
    }
  }
  
  if (isPanning) {
    await page.mouse.up();
  }
  
  console.log(`\n✓ Captured ${totalFrames} frames to ${CONFIG.framesDir}/`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Ensure output directory exists and is clean
  if (fs.existsSync(CONFIG.framesDir)) {
    const files = fs.readdirSync(CONFIG.framesDir);
    for (const file of files) {
      if (file.endsWith('.png')) {
        fs.unlinkSync(path.join(CONFIG.framesDir, file));
      }
    }
  } else {
    fs.mkdirSync(CONFIG.framesDir, { recursive: true });
  }
  
  console.log('🚀 Starting dev server...');
  const { proc: devServer, url } = await startDevServer();
  
  let browser: Browser | null = null;
  
  try {
    console.log(`   Dev server at ${url}`);
    
    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--window-size=${CONFIG.viewport.width + 50},${CONFIG.viewport.height + 100}`,
        '--disable-web-security',
      ],
    });
    
    const page = await browser.newPage();
    await page.setViewport(CONFIG.viewport);
    
    console.log('📄 Loading demo...');
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    await page.waitForSelector('#canvas');
    await sleep(1500);
    
    console.log('⚙️  Configuring visualization (Poincaré geometry)...');
    
    // 1. EXPLICITLY select Poincaré geometry by clicking the radio button
    await page.evaluate(() => {
      const poincareRadio = document.getElementById('geomPoincare') as HTMLInputElement;
      if (poincareRadio) {
        poincareRadio.checked = true;
        poincareRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await sleep(500);
    
    // 2. Point count: 100K (slider value 3)
    await page.evaluate(() => {
      const slider = document.getElementById('numPoints') as HTMLInputElement;
      if (slider) {
        slider.value = '3';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(500);
    
    // 3. Clustered dataset for interesting visuals
    await page.select('#datasetMode', 'clustered');
    await sleep(500);
    
    // 4. Seed for reproducibility
    await page.evaluate(() => {
      const seedInput = document.getElementById('seed') as HTMLInputElement;
      if (seedInput) {
        seedInput.value = '42';
        seedInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    // Wait for render
    console.log('⏳ Waiting for visualization to render...');
    await sleep(3000);
    
    // Verify we're in Poincaré mode
    const geometry = await page.evaluate(() => {
      const checked = document.querySelector<HTMLInputElement>('input[name="geometry"]:checked');
      return checked?.value;
    });
    console.log(`   Geometry mode: ${geometry}`);
    
    if (geometry !== 'poincare') {
      console.error('❌ Failed to select Poincaré geometry!');
      throw new Error('Geometry selection failed');
    }
    
    // Reset view with double-click
    const canvas = await page.$('#canvas');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
        await sleep(800);
      }
    }
    
    console.log('\n🎬 Starting capture...\n');
    await captureFrames(page);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Frame capture complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nTo create the GIF, run:\n');
    console.log(`ffmpeg -framerate ${CONFIG.frameRate} -i ${CONFIG.framesDir}/frame_%04d.png \\`);
    console.log(`  -vf "fps=10,scale=400:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \\`);
    console.log(`  -loop 0 -y ${CONFIG.outputGif}\n`);
    
  } finally {
    if (browser) await browser.close();
    if (devServer) await stopDevServer(devServer);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

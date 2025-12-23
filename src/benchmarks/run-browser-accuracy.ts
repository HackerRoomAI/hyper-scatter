#!/usr/bin/env npx tsx
/**
 * Automated Browser Accuracy Runner
 *
 * Runs the browser accuracy suite (reference vs candidate) and reports pass/fail.
 *
 * Usage:
 *   npx tsx src/benchmarks/run-browser-accuracy.ts
 *   npx tsx src/benchmarks/run-browser-accuracy.ts --headless
 *   npx tsx src/benchmarks/run-browser-accuracy.ts --dpr=2
 *   npx tsx src/benchmarks/run-browser-accuracy.ts --timeout=120000
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn, ChildProcess } from 'child_process';

function getNpxCommand(): string {
	// Windows uses npx.cmd; POSIX uses npx.
	return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`${label} timeout after ${ms}ms`));
		}, ms);
		// Ensure the timeout does not keep the process alive if everything else is done.
		(timer as any).unref?.();
	});

	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

async function stopDevServer(proc: ChildProcess): Promise<void> {
	if (proc.killed) return;

	// Best-effort shutdown. We avoid any awaited delays here so the Node process
	// can't exit early (top-level main() isn't awaited).
	try {
		if (process.platform !== 'win32' && proc.pid) {
			// If the server was spawned in its own process group, kill the group.
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

	// If the process (or one of its children) didn't die on SIGTERM, force kill.
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

interface AccuracyConfig {
	headless: boolean;
	dpr: number;
	timeout: number;
}

const DEFAULT_CONFIG: AccuracyConfig = {
	headless: false,
	dpr: 1,
	timeout: 120000,
};

function parseArgs(): Partial<AccuracyConfig> {
	const args: Partial<AccuracyConfig> = {};
	for (const arg of process.argv.slice(2)) {
		if (arg === '--headless') args.headless = true;
		if (arg === '--headed' || arg === '--no-headless') args.headless = false;
		if (arg.startsWith('--dpr=')) {
			const v = Number(arg.slice('--dpr='.length));
			if (Number.isFinite(v) && v > 0) args.dpr = v;
		}
		if (arg.startsWith('--timeout=')) {
			const v = Number(arg.slice('--timeout='.length));
			if (Number.isFinite(v) && v > 0) args.timeout = v;
		}
	}
	return args;
}

async function startDevServer(): Promise<{ proc: ChildProcess; url: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(getNpxCommand(), ['vite', '--port', '5175', '--strictPort'], {
			stdio: ['ignore', 'pipe', 'pipe'],
			// `shell: true` makes it harder to reliably kill the actual Vite process.
			shell: false,
			// On POSIX, start a new process group so we can kill the whole tree.
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
			if (!resolved) {
				clearTimeout(timeoutId);
				reject(err);
			}
		});
	});
}

async function runAccuracy(page: Page): Promise<{ allPassed: boolean; summary: string; reports: any[] }> {
	return page.evaluate(async () => {
		const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
		if (!canvas) throw new Error('Canvas element not found');

		const VizBenchmark = (window as any).VizBenchmark;
		if (!VizBenchmark?.runAccuracyBenchmarks) {
			throw new Error('VizBenchmark.runAccuracyBenchmarks not found');
		}

		const reports = await VizBenchmark.runAccuracyBenchmarks(canvas);
		const allPassed = reports.every((r: any) => r?.allPassed);
		const summary = reports.map((r: any) => `${r.geometry}: ${r.summary}`).join(' | ');
		return { allPassed, summary, reports };
	});
}

async function main() {
	const config: AccuracyConfig = { ...DEFAULT_CONFIG, ...parseArgs() };

	console.log('\x1b[1m\x1b[36m[Browser Accuracy]\x1b[0m Starting...');
	console.log(`  Headless: ${config.headless}`);
	console.log(`  DPR: ${config.dpr}`);
	console.log(`  Timeout: ${config.timeout}ms`);
	console.log('');

	let devServer: { proc: ChildProcess; url: string } | null = null;
	let browser: Browser | null = null;

	try {
		console.log('\x1b[33m[1/3]\x1b[0m Starting dev server...');
		devServer = await startDevServer();
		console.log(`  Dev server running at ${devServer.url}`);

		console.log('\x1b[33m[2/3]\x1b[0m Launching browser...');
		browser = await puppeteer.launch({
			headless: config.headless,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-background-timer-throttling',
				'--disable-backgrounding-occluded-windows',
				'--disable-renderer-backgrounding',
				'--disable-features=CalculateNativeWinOcclusion',
				'--ignore-gpu-blocklist',
				'--window-size=1200,800',
			],
		});

		const page = await browser.newPage();
		// tsx/esbuild may wrap serialized functions passed to page.evaluate() with
		// __name(...) calls. Define a no-op __name helper in the page context.
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (page as any).evaluateOnNewDocument('globalThis.__name = (fn) => fn;');
		} catch {
			// ignore
		}
		await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: config.dpr });

		console.log('\x1b[33m[3/3]\x1b[0m Running accuracy tests...');
		await page.goto(`${devServer.url}/benchmark.html`, { waitUntil: 'networkidle0' });
		await page.bringToFront();

		const { allPassed, summary, reports } = await withTimeout(
			runAccuracy(page),
			config.timeout,
			'Accuracy'
		);

		if (allPassed) {
			console.log(`\n\x1b[32mPASSED\x1b[0m  ${summary}`);
			process.exitCode = 0;
		} else {
			console.log(`\n\x1b[31mFAILED\x1b[0m  ${summary}`);
			// Print some helpful details so CI logs are actionable.
			for (const r of reports ?? []) {
				if (!r?.allPassed) {
					console.log(`\n--- ${r.geometry} failures ---`);
					for (const t of r.tests ?? []) {
						if (!t?.passed) {
							console.log(`- ${t.operation}: ${t.details ?? 'failed'}`);
						}
					}
				}
			}
			process.exitCode = 1;
		}
	} catch (err) {
		console.error('\x1b[31mAccuracy run failed:\x1b[0m', err);
		process.exitCode = 1;
	} finally {
		// Cleanup is best-effort; failures here should not hide the test result.
		try {
			if (browser) await browser.close();
		} catch {
			// ignore
		}
		try {
			if (devServer) await stopDevServer(devServer.proc);
		} catch {
			// ignore
		}
		console.log('\n[Browser Accuracy] Done.');
	}
}

main();


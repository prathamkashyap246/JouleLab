// End-to-end browser tests: real backend + real frontend + Chromium, with virtual boards.
//   cd frontend && npm run test:e2e
// Needs: macOS or Linux (virtual serial ports), the backend venv (backend/venv), and Playwright:
//   npm i -D playwright && npx playwright install chromium
// Boards are simulated: the NUCLEO is scripts/send_test_samples.py (packets flagged TEST), the ESP32
// is fake_esp32.py, and PlatformIO is fake_pio.py. So this checks JouleLab itself, not compilers.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const backend = path.join(root, 'backend'), frontend = path.join(root, 'frontend');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('Playwright is missing: npm i -D playwright && npx playwright install chromium'); process.exit(2);
}
const python = process.env.JOULELAB_PYTHON || [path.join(backend, 'venv/bin/python'), 'python3'].find(p => p === 'python3' || existsSync(p));
const tmp = mkdtempSync(path.join(tmpdir(), 'joulelab-e2e-'));
const BPORT = 18000 + Math.floor(Math.random() * 1000), FPORT = BPORT + 1000;
const procs = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function start(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  p.output = () => out; procs.push(p); return p;
}
async function firstLine(p) { for (let i = 0; i < 100; i++) { const m = p.output().match(/\/dev\/\S+/); if (m) return m[0]; await sleep(50); } throw new Error('virtual port did not start: ' + p.output()); }
async function waitHttp(url) { for (let i = 0; i < 120; i++) { try { if ((await fetch(url)).ok) return; } catch { } await sleep(250); } throw new Error('not reachable: ' + url); }
function cleanup() { for (const p of procs) { try { p.kill('SIGTERM'); } catch { } } }
process.on('exit', cleanup);

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  ✓', name); }
  catch (e) { results.push([false, name]); console.log('  ✗', name, '\n     ', String(e.message || e).split('\n')[0]); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  chmodSync(path.join(here, 'fake_pio.py'), 0o755);
  const nucleo = await firstLine(start(python, [path.join(backend, 'scripts/send_test_samples.py'), '--virtual'], { cwd: backend }));
  const esp = await firstLine(start(python, [path.join(here, 'fake_esp32.py')]));
  const env = { ...process.env, ALLOW_TEST_SOURCES: 'true', DATABASE_PATH: path.join(tmp, 'db.sqlite'),
    PROJECTS_DIR: path.join(tmp, 'projects'), PROXY_KEY_FILE: path.join(tmp, 'proxy.key'), PIO_PATH: path.join(here, 'fake_pio.py'),
    JOULELAB_PROXY_KEY: '' };
  start(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BPORT)], { cwd: backend, env });
  await waitHttp(`http://127.0.0.1:${BPORT}/`);
  start('node', ['server.js'], { cwd: frontend, env: { ...env, PORT: String(FPORT), BACKEND_URL: `http://127.0.0.1:${BPORT}`, HOST: '127.0.0.1', JOULELAB_PASSWORD: '' } });
  const site = `http://127.0.0.1:${FPORT}`;
  await waitHttp(site + '/');
  console.log(`JouleLab e2e · site ${site} · NUCLEO(test) ${nucleo} · ESP32(fake) ${esp}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const external = []; page.on('request', r => { const u = r.url(); if (!u.startsWith(site) && !u.includes('fonts.g')) external.push(u); });
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(page._answer || '') : d.accept());

  await check('lab page renders with local React (no CDN, no in-browser Babel)', async () => {
    await page.goto(site + '/#lab', { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Module separation', { timeout: 10000 });
    expect(!external.length, 'external requests: ' + external.join(', '));
  });

  await check('live hardware streams the (TEST-labelled) NUCLEO and shows the idle baseline', async () => {
    await page.click('text=Live hardware');
    await page.fill('input[placeholder^="COM5"]', nucleo);
    await page.click('button:has-text("Connect")');
    await page.waitForSelector('text=TEST DATA · NOT FROM HARDWARE', { timeout: 10000 });
    await page.waitForSelector('text=Idle baseline: idle_sleep', { timeout: 10000 });
    const t = await page.locator('.hw-table').innerText();
    expect(/send_data/.test(t) && /Above idle/.test(t), 'function table incomplete');
  });

  await check('full-rate session records and feeds module separation', async () => {
    await page.check('.hw-check input');
    await page.click('text=Start session'); await page.waitForSelector('text=● REC');
    await sleep(3000);
    await page.click('text=Stop & save'); await sleep(800);
    await page.click('.tabs >> text=Module separation');
    await page.selectOption('.sep select >> nth=0', 'session'); await sleep(500);
    const resp = page.waitForResponse(r => r.url().includes('/analysis/separate'), { timeout: 60000 });
    await page.click('.sep button:has-text("Separate")');
    const r = await resp; const j = await r.json();
    expect(r.status() === 200 && j.k >= 1 && j.simulated === true, `status ${r.status()} ${JSON.stringify(j).slice(0, 150)}`);
  });

  await check('workspace: Verify succeeds and streams output', async () => {
    await page.goto(site + '/workspace', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#devboard option').length === 3);
    await page.selectOption('#devboard', 'nucleo_f446re'); await page.click('#openproj'); await sleep(300);
    await page.click('#verify'); await page.waitForSelector('#jobstate.js-succeeded', { timeout: 15000 });
    expect(/Processing nucleo_f446re/.test(await page.textContent('#con-out')), 'no build output');
  });

  await check('Run on the ESP32 opens its output on the LOG port while the NUCLEO keeps measuring', async () => {
    await page.selectOption('#devboard', 'esp32dev'); await page.click('#openproj'); await sleep(300);
    page._answer = esp; await page.selectOption('#devport', '__other'); await sleep(500);
    await page.click('#run');
    await page.waitForFunction(() => /work\(\) done/.test(document.getElementById('con-log').textContent), null, { timeout: 15000 });
    const hw = await (await fetch(`http://127.0.0.1:${BPORT}/api/hardware/status`)).json();
    expect(hw.port === nucleo && hw.connected, 'measurement connection was disturbed: ' + hw.state);
  });

  await check('terminal input reaches the board and its reply is shown', async () => {
    await page.fill('#termcmd', 'led on'); await page.click('#termform button[type=submit]');
    await page.waitForFunction(() => /ESP32 echo: led on/.test(document.getElementById('con-log').textContent), null, { timeout: 5000 });
  });

  await check('debug session takes GDB commands and Stop ends it', async () => {
    await page.selectOption('#devboard', 'nucleo_f446re'); await page.click('#openproj'); await sleep(300);
    await page.click('#debug'); await page.waitForSelector('#gdbform:not([hidden])', { timeout: 10000 });
    await page.click('[data-gdb="bt"]');
    await page.waitForFunction(() => /FAKE gdb got: bt/.test(document.getElementById('con-out').textContent), null, { timeout: 5000 });
    await page.click('#stop'); await page.waitForSelector('#gdbform[hidden]', { state: 'attached', timeout: 8000 });
  });

  await check('no JavaScript errors on any page', async () => expect(!errors.length, errors.join(' | ')));
  await browser.close();

  const failed = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  cleanup();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); cleanup(); process.exit(1); });

// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// The games are seeded bot games, so the same pictures come out every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
// Save a screenshot as a 256-colour PNG: a fraction of the size, and it looks the same.
const UPNG = require('upng-js');
async function save(target, file) {
  const png = await target.screenshot({ type: 'png' });
  const img = UPNG.decode(png);
  await writeFile(join(root, file), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
}
const SEED = 11, ROUND = 14; // a game this far along has a good-looking town
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: viewport.width < 900, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('boomtown.prefs', JSON.stringify({ sound: false, speed: 'normal', len: 'standard', seats: [{ who: 'you', name: 'You' }, { who: 'rusty' }, { who: 'mabel' }, { who: 'dot' }] })));
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// A bot game played to a round, then handed to a person in seat 0, at the start of their turn.
async function midGame(page, seed = SEED, round = ROUND) {
  await page.evaluate(async ([seed, round]) => {
    const { G } = window.boomtown;
    const { botStep } = await import('./js/bots.js');
    const names = [['You', 'gus'], ['Rusty', 'rusty'], ['Mabel', 'mabel'], ['Dot', 'dot']];
    const s = G.newGame({ seats: names.map(([name, bot], k) => ({ name, kind: 'bot', bot, token: k })), seed });
    while (!(s.round === round && s.turn === 0 && s.phase === 'roll')) botStep(s);
    s.players[0].kind = 'human'; s.players[0].bot = null;
    s.log = s.log || [];
    window.boomtown.start(s, true);
  }, [seed, round]);
  await page.waitForTimeout(500);
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await save(page, 'docs/phone-title.png');
  await midGame(page);
  await page.click('#actions button:has-text("Roll the dice")');
  await page.waitForSelector('.move-btn');
  await page.waitForTimeout(700);
  await save(page, 'docs/phone-move.png');
  // A Gazette headline.
  await page.evaluate(() => {
    const s = window.boomtown.state;
    s.deck.unshift('boom-hill');
    s.players[0].pos = 15; s.dice = [1, 0];
  });
  await page.evaluate(async () => {
    const s = window.boomtown.state; const { G } = window.boomtown;
    s.dice = [1, 1]; s.phase = 'move';
  });
  await page.evaluate(() => window.boomtown.render());
  await page.click('.move-btn >> nth=1');
  await page.waitForSelector('#sheet .gazette');
  await page.waitForTimeout(500);
  await save(page, 'docs/phone-gazette.png');
  await page.context().close();
}

// Founders' Day, at the end of a whole game.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await page.evaluate(async () => {
    const { G } = window.boomtown;
    const { botStep } = await import('./js/bots.js');
    const names = [['You', 'gus'], ['Rusty', 'rusty'], ['Mabel', 'mabel'], ['Dot', 'dot']];
    const s = G.newGame({ seats: names.map(([name, bot], k) => ({ name, kind: 'bot', bot, token: k })), seed: 5 });
    while (!(s.round === s.rounds && s.turn === 3 && s.phase === 'manage')) botStep(s);
    s.players[0].kind = 'human';
    s.players[3].kind = 'human';
    window.boomtown.start(s, true);
  });
  await page.waitForTimeout(400);
  await page.click('#actions button:has-text("End turn")');
  await page.waitForSelector('.standings li');
  await page.waitForTimeout(600);
  await save(page, 'docs/phone-founders-day.png');
  await page.context().close();
}

// Link preview, 1200 x 630: the name and a line on the left, the board from a real game on the right.
{
  const page = await open({ width: 1280, height: 900 }, 1);
  await midGame(page, SEED, 17);
  await page.addStyleTag({ content: '#actions, #say { visibility: hidden; }' });
  await page.evaluate(() => { window.boomtown.state.dice = [5, 3]; window.boomtown.render(); });
  await page.waitForTimeout(500);
  const shot = await (await page.$('.board-wrap')).screenshot({ type: 'png' });
  const font = async f => (await readFile(join(root, 'fonts', f))).toString('base64');
  const card = await open({ width: 1200, height: 630 }, 1);
  await card.setContent(`<!doctype html><style>
    @font-face { font-family: Slab; src: url(data:font/woff2;base64,${await font('alfa-slab-one.woff2')}); }
    @font-face { font-family: Franklin; src: url(data:font/woff2;base64,${await font('libre-franklin.woff2')}); font-weight: 100 900; }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { background: radial-gradient(ellipse at 30% 30%, #2b513c, #21402f 50%, #17301f); display: flex; align-items: center; font-family: Franklin; }
    .words { width: 560px; padding-left: 64px; color: #f3e9cf; flex: none; }
    h1 { font: 92px/1 Slab; margin: 0; color: #f3e9cf; }
    h1 span { color: #e2b23c; }
    p { font-size: 33px; line-height: 1.25; font-weight: 600; margin: 22px 0 0; opacity: .92; max-width: 470px; }
    img { width: 540px; height: 540px; border-radius: 10px; box-shadow: 0 16px 40px #0008; transform: rotate(3deg); }
  </style><div class="words"><h1><span>Boom</span>town</h1><p>Buy land in a town that isn't built yet. Richest on Founders' Day wins.</p></div>
  <img src="data:image/png;base64,${shot.toString('base64')}">`);
  await card.waitForTimeout(300);
  await save(card, 'og.png');
  await card.context().close();
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');

// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Skeleton from the junkdrawer skill: the checks at the bottom are the ones every project wants;
// add the ones that prove this app does its job.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// The server answers the way GitHub Pages does: a browser may keep each file for ten minutes, and asks again by its
// ETag. `net` is the connection: 'up', 'down' (the server drops every connection), 'stalled' (a train, a captive
// wifi: it takes each request and holds on to it), 'files stalled' (it answers for a page, then holds on to the files
// the page loads) or 'scripts stalled' (it holds on to the scripts only). With `release` set it serves the next
// release (see the end); with `release` 'files', a next release that changes the css and js but not index.html.
let net = 'up', release = false;
const held = [];
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (net === 'down') { req.socket.destroy(); return; }
  if (net === 'stalled' || (net === 'files stalled' && !/(\/|\.html)$/.test(path)) || (net === 'scripts stalled' && path.endsWith('.js'))) {
    held.push([req, res]);
    return;
  }
  serve(req, res);
}).listen(0);
async function serve(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  let body;
  try { body = await readFile(join(root, path)); } catch { res.writeHead(404); res.end(); return; }
  if (release && path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
  else if (release && /\.(css|js)$/.test(path)) body = Buffer.concat([body, Buffer.from('\n/* the next release */\n')]);
  if (release === true && path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
  const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  const head = { etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
  res.writeHead(200, head);
  res.end(body);
}
const base = `http://localhost:${server.address().port}/`;
// The connection comes back: the held requests are answered (as things are now, before `release` next changes).
const unstall = () => { net = 'up'; return Promise.all(held.splice(0).map(([req, res]) => serve(req, res))); };
// Waits for ok() to come true, for up to ms, or fails saying what didn't happen.
const until = async (ok, ms, what) => {
  for (const end = Date.now() + ms; !(await ok());) { assert.ok(Date.now() < end, what); await new Promise(r => setTimeout(r, 100)); }
};

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);

// Installable: Chromium finds nothing wrong with the manifest or icons.
{
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, [], 'Chromium says it cannot install');
  const { errors } = await cdp.send('Page.getAppManifest');
  assert.deepEqual(errors, [], 'manifest errors');
}

// The title screen: pick a short game against one of the townsfolk.
assert.equal(await page.isVisible('#title'), true, 'the title screen shows first');
await page.evaluate(() => localStorage.setItem('boomtown.prefs', JSON.stringify({ speed: 'fast', sound: false, len: 'short', seats: [{ who: 'you', name: 'You' }, { who: 'mabel' }, { who: 'none' }, { who: 'none' }] })));
await page.reload();
assert.equal(await page.textContent('#len-short'), '18 rounds', 'two players get more rounds');
{
  const [dot, link] = await page.$$eval('.title-links > span, #rulesBtn', es => es.map(e => { const g = document.createRange(); g.selectNodeContents(e); const r = g.getBoundingClientRect(); return r.top + r.height / 2; }));
  assert.ok(Math.abs(dot - link) < 2, `the dot between the title screen's links sits ${(link - dot).toFixed(1)} px off their middle`);
}
await page.click('#startBtn');
await page.waitForSelector('#actions button:has-text("Roll the dice")');
assert.equal(await page.textContent('#round'), 'Round 1 of 18');

// A turn: roll, pick a move from the board's three, answer what the space asks, end the turn.
const sheetOpen = () => page.$eval('#sheetWrap', el => !el.hidden);
const answer = async () => {
  for (let k = 0; k < 6 && await sheetOpen(); k++) {
    const b = await page.$('#sheet [data-ok], #sheet [data-c="buy"]:not([disabled]), #sheet [data-c="pay"], #sheet .pick:not([disabled]), #sheet [data-c="pass"]');
    if (!b) break;
    await b.click();
    await page.waitForTimeout(400);
  }
};
await page.click('#actions button:has-text("Roll the dice")');
await page.waitForSelector('.move-btn');
const moves = await page.$$eval('.move-btn', bs => bs.map(b => b.textContent));
assert.ok(moves.length >= 2 && /Both dice/.test(moves[0]), 'both dice and a detour are offered');
assert.equal(await page.$$eval('#board .dest', d => d.length), moves.length, 'the board marks where each move lands');
const before = await page.evaluate(() => window.boomtown.state.players[0].pos);
await page.click('.move-btn >> nth=0');
await page.waitForFunction(p => window.boomtown.state.players[0].pos !== p, before);
await page.waitForTimeout(1500);
await answer();
await page.waitForSelector('#actions button:has-text("End turn")');
await page.click('#actions button:has-text("End turn")');
// Mabel plays, then it's back to us.
await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 20000 });
assert.equal(await page.evaluate(() => window.boomtown.state.turn), 0);
assert.ok((await page.textContent('#log')).includes('Mabel rolled'), 'the log says what Mabel did');

// Tapping a space tells you about it.
await page.click('#board .cell[data-i="17"]');
assert.equal(await sheetOpen(), true);
assert.match(await page.textContent('#sheet h2'), /Main Street/);
await page.click('#sheet [data-close]');

// Leaving and coming back carries on where it was.
const round = await page.textContent('#round');
await page.reload();
assert.equal(await page.isVisible('#resumeBtn'), true, 'Carry on is offered');
await page.click('#resumeBtn');
assert.equal(await page.textContent('#round'), round);
await page.waitForSelector('#actions button:has-text("Roll the dice")');

// Play the rest of the game to Founders' Day, through the real buttons.
for (let k = 0; k < 2000; k++) {
  const st = await page.evaluate(() => { const s = window.boomtown.state; return { phase: s.phase, kind: s.players[s.turn].kind }; });
  if (st.phase === 'over') break;
  if (await sheetOpen()) { await answer(); continue; }
  const b = st.kind === 'human' && await page.$('#actions button:has-text("Roll the dice"), .move-btn, #actions button:has-text("End turn"), #actions button:has-text("Decide")');
  if (b) { await b.click(); await page.waitForTimeout(120); } else await page.waitForTimeout(150);
}
await page.waitForSelector('.standings li', { timeout: 10000 });
assert.equal(await page.$$eval('.standings li', l => l.length), 2, "Founders' Day ranks both players");
assert.match(await page.textContent('#sheet .gazette .head'), /richest in Boomtown/i);
assert.equal(await page.isVisible('#sheet .chart'), true);
await page.click('#sheet [data-a="again"]');
await page.waitForSelector('#actions button:has-text("Roll the dice")');
assert.equal(await page.textContent('#round'), 'Round 1 of 18', 'Play again starts a new game');
assert.equal(await sheetOpen(), false, "Founders' Day stays open over the new game");

// On a phone held upright the board stands taller than it is wide, and the middle has room for the buttons.
const box = await page.$eval('.board-wrap', el => el.getBoundingClientRect().toJSON());
assert.ok(box.height > box.width * 1.3, 'the board is tall on a phone');
assert.ok(box.width >= 370, 'the board uses the width of the phone');

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// Scenes: a seeded bot game played to a round and handed to a person in seat 0 (as tools/screenshots.mjs does), with
// `setup`, the body of a function of s, G (js/game.js) and B (js/board.js), run on it before it starts.
const scene = async (setup = '', { seed = 11, round = 14 } = {}) => {
  await page.evaluate(async ([seed, round, setup]) => {
    const { G } = window.boomtown;
    const { botStep } = await import('./js/bots.js');
    const B = await import('./js/board.js');
    const names = [['You', 'gus'], ['Rusty', 'rusty'], ['Mabel', 'mabel'], ['Dot', 'dot']];
    const s = G.newGame({ seats: names.map(([name, bot], k) => ({ name, kind: 'bot', bot, token: k })), seed });
    while (!(s.round === round && s.turn === 0 && s.phase === 'roll')) botStep(s);
    s.players[0].kind = 'human'; s.players[0].bot = null;
    new Function('s', 'G', 'B', setup)(s, G, B);
    window.boomtown.start(s, true);
  }, [seed, round, setup]);
  await page.waitForTimeout(300);
};

// Every player's card keeps the same two rows, whatever the amounts: name and cash, then worth or what they owe.
await scene('s.players[0].cash = 12345; s.players[2].cash = 0; s.players[2].debt = 1230;');
for (const width of [390, 375]) {
  await page.setViewportSize({ width, height: width === 375 ? 667 : 844 });
  await page.waitForTimeout(200);
  const chips = await page.$$eval('.chip', cs => cs.map(c => ({ h: c.offsetHeight, nm: c.querySelector('.nm').getBoundingClientRect().top, cash: c.querySelector('.cash').getBoundingClientRect().top, text: c.textContent.replace(/\s+/g, ' ').trim() })));
  assert.equal(new Set(chips.map(c => c.h)).size, 1, `player cards differ in height at ${width}px: ${JSON.stringify(chips)}`);
  for (const c of chips) assert.ok(Math.abs(c.nm - c.cash) < 6, `cash is not beside the name at ${width}px: ${c.text}`);
  assert.deepEqual(await page.$$eval('.chip .nm, .chip .sub', es => es.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)), [], `card text is cut off at ${width}px`);
  assert.match(chips[2].text, /owes \$1,230/, 'a card with a loan says what is owed');
}
await page.setViewportSize({ width: 390, height: 844 });

// The tall board's tags are big enough to read on a phone, written like every other amount ($1,440), and stay
// inside their cells; the Payday corner says what Payday pays.
await scene("B.LOTS_IN.bank.forEach(i => { s.owner[i] = 3; s.level[i] = 3; }); s.land.bank = 1.6;");
{
  const tags = await page.$$eval('#board .cell', cells => cells.flatMap(c => {
    const t = c.querySelector('text.pill');
    if (!t) return [];
    const cell = c.querySelector('.bg').getBBox(), tag = t.previousElementSibling.getBoundingClientRect(), box = c.querySelector('.bg').getBoundingClientRect();
    return [{ text: t.textContent, size: parseFloat(getComputedStyle(t).fontSize), inside: tag.left >= box.left - 0.5 && tag.right <= box.right + 0.5, w: cell.width }];
  }));
  const big = tags.filter(t => t.text.replace(/\D/g, '') >= 1000);
  assert.ok(big.length && big.every(t => /^\$\d{1,3}(,\d{3})+$/.test(t.text)), `amounts of $1,000 and more on the board have no comma: ${JSON.stringify(big)}`);
  assert.deepEqual(tags.filter(t => !t.inside), [], 'a tag reaches outside its cell');
  assert.ok(tags.filter(t => t.text.length <= 5).every(t => t.size >= 26), `short tags on the tall board are small: ${JSON.stringify(tags)}`);
  assert.equal(await page.textContent('#board .cell[data-i="0"] .corner-sub'), '$' + await page.evaluate(() => window.boomtown.G.RULES.salary));
}

// On a small phone the buttons in the middle of the board keep to one line each.
await page.setViewportSize({ width: 375, height: 667 });
await scene("s.phase = 'manage'; s.dice = [1, 2];");
assert.deepEqual(await page.$$eval('#actions .row button', bs => bs.filter(b => { const r = document.createRange(); r.selectNodeContents(b); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1; }).map(b => b.textContent)),
  [], 'a button in the middle of the board wraps onto two lines at 375 px');
await page.setViewportSize({ width: 390, height: 844 });

// A question about a lot rings the lot on the board, and its answers stay in view while the sheet scrolls, even on a
// phone held sideways, without covering the end of the rent table.
const RENT = `const at = Object.keys(s.owner).map(Number).find(i => s.owner[i] > 0 && s.level[i] === 0 && G.buyoutPrice(s, i) != null);
  s.players[0].pos = at; s.dice = [3, 4]; s.phase = 'decide';
  s.pending = { kind: 'rent', at, owner: s.owner[at], rent: G.rentFor(s, at), buyout: G.buyoutPrice(s, at) };`;
await page.setViewportSize({ width: 844, height: 390 });
await scene(RENT);
await page.waitForSelector('#sheet [data-c="pay"]');
{
  const at = await page.evaluate(() => window.boomtown.state.pending.at);
  const ring = await page.$eval('#board .focus-ring', r => { const b = r.getBBox(); return { x: b.x, y: b.y }; }).catch(() => null);
  const cell = await page.$eval(`#board .cell[data-i="${at}"] .bg`, r => { const b = r.getBBox(); return { x: b.x, y: b.y }; });
  assert.ok(ring && Math.abs(ring.x - cell.x - 3) < 1 && Math.abs(ring.y - cell.y - 3) < 1, 'the lot the rent is for is not ringed on the board');
  const fits = () => page.$eval('#sheet', sh => { const v = sh.getBoundingClientRect(), b = sh.querySelector('[data-c="pay"]').getBoundingClientRect(); return sh.scrollHeight > sh.clientHeight && b.top >= v.top && b.bottom <= v.bottom; });
  assert.equal(await fits(), true, "the rent sheet's Pay button is out of view sideways");
  await page.$eval('#sheet', sh => { sh.scrollTop = sh.scrollHeight; });
  assert.equal(await page.$eval('#sheet .facts tr:last-child td', td => { const r = td.getBoundingClientRect(); return document.elementFromPoint(r.left + 4, r.top + r.height / 2) === td; }), true,
    'the answers cover the last row of the rent table');
}
await page.setViewportSize({ width: 390, height: 844 });
await scene();
await page.click('#board .cell[data-i="17"]');
assert.equal(await page.$$eval('#board .focus-ring', r => r.length), 1, 'a tapped space is not ringed on the board');
await page.click('#sheet [data-close]');
assert.equal(await page.$$eval('#board .focus-ring', r => r.length), 0, 'the ring stays after the sheet closes');

// Works offline once it has been opened. The server goes down as well as the browser: in some Chromium builds the
// browser's offline switch alone doesn't stop the service worker's own requests, and this passed with no copy at all.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
const title = await page.title();
// The page opened from a link with a query string (a shared link's ?fbclid=…) is kept in the copy under its plain
// address: see the release below.
await page.goto(base + '?x=1');
await page.goto(base);
net = 'down';
await ctx.setOffline(true);
await page.reload();
assert.equal(await page.title(), title, 'the page did not open offline');
await ctx.setOffline(false);

// On a connection that's up but not answering, it opens from the copy too, after the worker's few seconds' wait for
// the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't open).
net = 'stalled';
const t0 = Date.now();
await page.reload({ timeout: 10000 }).catch(() => {});
const took = Date.now() - t0;
assert.ok(took < 8000, `the page took ${took} ms to open on a stalled connection`);
assert.equal(await page.title(), title, 'the page did not open on a stalled connection');
await unstall();

// On a connection that answers for the page but then holds on to the files it loads, it opens too: after the same
// wait, a file the copy has comes from it, and the rest of that page's files come from it straight away.
net = 'files stalled';
const t1 = Date.now();
await page.reload({ timeout: 10000 }).catch(() => {});
const took1 = Date.now() - t1;
assert.ok(took1 < 7000 && await page.evaluate(() => document.readyState) === 'complete', `the page took ${took1} ms to open when the files it loads stalled`);
await unstall();

// But never as a mix of two releases: a page the network has started sending newer files than the copy's (here the
// next release's css, the page itself unchanged), or a page newer than the copy's, waits on for the network.
const waitsForNetwork = async what => {
  await page.reload({ timeout: 5500 }).catch(() => {});
  assert.notEqual(await page.evaluate(() => document.readyState), 'complete', what);
};
release = 'files';
net = 'scripts stalled';
await waitsForNetwork("the copy's scripts opened a page beside the next release's css");
release = false;
await unstall();
await page.waitForFunction(() => document.readyState === 'complete');
release = true;
net = 'files stalled';
await waitsForNetwork("the copy's files opened the next release's page");
await unstall();
await page.waitForFunction(() => document.readyState === 'complete');

// A new release: every file in the new copy comes from the server, though the browser still has its own copies of
// the old ones for ten minutes. (The next release changes index.html, and so FILES in sw.js, as a real one does.)
release = true;
await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
await until(() => page.evaluate(async () => !!(await (await caches.match('index.html'))?.text())?.includes('<!-- the next release -->')),
  10000, "the new release's offline copy kept the old index.html");
// With the network down, the page opens from the new release's copy, not from an old page kept under ?x=1 (which
// would run the old index.html with the new release's files).
net = 'down';
await ctx.setOffline(true);
await page.reload();
assert.equal(await page.evaluate(() => [...document.childNodes].some(n => n.nodeType === Node.COMMENT_NODE && n.data.includes('the next release'))), true,
  'offline after a release, the page opened from an old copy kept under its query string');
assert.deepEqual(await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map(r => r.url).filter(u => u.includes('?'))), [],
  'the copy kept a page under its query string');
await ctx.setOffline(false);
net = 'up';
release = false;

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();

// sw.js changes whenever a file it keeps does, so a release replaces the whole offline copy at once: FILES in sw.js is
// a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read as its
// index.html; the first 8 hex of the sha1 of those).
const sw = await readFile(join(root, 'sw.js'), 'utf8');
const shell = [...sw.match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);
const all = createHash('sha1');
for (const f of shell) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
const files = all.digest('hex').slice(0, 8);
assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
console.log('all good');

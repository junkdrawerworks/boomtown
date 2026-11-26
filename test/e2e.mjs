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

// The page as a screen reader gets it: Chromium's accessibility tree.
const axTree = async p => {
  const c = await p.context().newCDPSession(p);
  const { nodes } = await c.send('Accessibility.getFullAXTree');
  await c.detach();
  return nodes;
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
// The pace is beside the game's length, as well as in the menu: a tap on Easy or Fast changes it, and the other.
assert.deepEqual(await page.$$eval('#paces button', bs => bs.map(b => [b.textContent, b.getAttribute('aria-pressed')])), [['Easy', 'false'], ['Fast', 'true']]);
await page.click('#paces [data-speed="normal"]');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('boomtown.prefs')).speed), 'normal', 'a tap on Easy on the title screen does not change the pace');
assert.deepEqual(await page.$$eval('#paces button', bs => bs.map(b => b.getAttribute('aria-pressed'))), ['true', 'false']);
await page.click('#paces [data-speed="fast"]');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('boomtown.prefs')).speed), 'fast', 'a tap on Fast on the title screen does not change the pace');
{
  const [dot, link] = await page.$$eval('.title-links > span, #rulesBtn', es => es.map(e => { const g = document.createRange(); g.selectNodeContents(e); const r = g.getBoundingClientRect(); return r.top + r.height / 2; }));
  assert.ok(Math.abs(dot - link) < 2, `the dot between the title screen's links sits ${(link - dot).toFixed(1)} px off their middle`);
}
// The title says who the townsfolk are, and Break ground is in view on a phone without scrolling.
assert.match(await page.textContent('#title'), /Rusty, Mabel, Dot and Gus are the townsfolk: the game plays them\./);
assert.ok(await page.$eval('#startBtn', b => b.getBoundingClientRect().bottom <= innerHeight), 'Break ground is below the fold on a phone');
// How to play says why later seats start with more.
await page.click('#rulesBtn');
assert.match(await page.textContent('#sheet'), /Whoever goes later starts with a little more: \$50 for each seat after the first\./);
await page.click('#sheet [data-close]');
// Records are kept on this device; the links in the title's footer open in place here (only the one-file copy opens them
// beside the game).
await page.click('#recordsBtn');
assert.equal(await page.textContent('#sheet .note'), 'Kept on this device only.');
await page.click('#sheet [data-close]');
assert.deepEqual(await page.$$eval('.jd-foot a', as => as.map(a => a.target)), ['', '']);
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
// The focus moves on to the first move (see the keyboard's turn below), but after a tap it draws no ring.
await page.waitForFunction(() => !window.boomtown.busy);
assert.deepEqual(await page.evaluate(() => [document.activeElement.classList.contains('move-btn'), getComputedStyle(document.activeElement).outlineStyle]), [true, 'none'],
  'after a tap on Roll the dice, the first move is not focused, or shows the keyboard\'s ring');
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
assert.match(await page.textContent('#sheet h2'), /High Street Corner/);
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
  // A sheet can open between the look for one and the tap (a headline, after a move's hop): the tap then waits behind
  // it, so it gives up soon and the next go round answers the sheet.
  if (b) { await b.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(120); } else await page.waitForTimeout(150);
}
await page.waitForSelector('.standings li', { timeout: 10000 });
assert.equal(await page.$$eval('.standings li', l => l.length), 2, "Founders' Day ranks both players");
assert.match(await page.textContent('#sheet .gazette .head'), /richest in Boomtown/i);
assert.equal(await page.isVisible('#sheet .chart'), true);
// Founders' Day is read out by its headline, its ✕ isn't covered by the Gazette, and the chart says where each player
// ended.
{
  const dialog = (await axTree(page)).find(n => n.role?.value === 'dialog' && !n.ignored);
  assert.match(dialog?.name?.value || '', /richest in Boomtown/i, "Founders' Day has no name for a screen reader");
  assert.equal(await page.$eval('#sheet .close', c => { const r = c.getBoundingClientRect(); return document.elementFromPoint(r.right - 6, r.top + r.height / 2)?.closest('.close') === c; }), true,
    "the Gazette covers Founders' Day's ✕");
  assert.match(await page.getAttribute('#sheet .chart', 'aria-label'), /round by round\. (You|Mabel) ended on −?\$[\d,]+, (You|Mabel) on −?\$[\d,]+\.$/, "the chart doesn't say where each player ended");
}
const firstGame = await page.evaluate(() => window.boomtown.state.players.map(p => [p.name, p.token, p.history[0]]));
await page.click('#sheet [data-a="again"]');
await page.waitForSelector('#actions button:has-text("Roll the dice")');
assert.equal(await page.textContent('#round'), 'Round 1 of 18', 'Play again starts a new game');
// Play again moves who goes first one seat round the table: Mabel starts this time, with the first seat's cash, and
// everyone keeps their piece.
{
  const [[you, yours, least], [mabel, hers, more]] = firstGame;
  assert.deepEqual(await page.evaluate(() => window.boomtown.state.players.map(p => [p.name, p.token, p.history[0]])), [[mabel, hers, least], [you, yours, more]],
    'Play again does not move who goes first round the table');
  assert.ok((await page.evaluate(() => window.boomtown.state.log)).includes('A new game: 18 rounds, 2 players. Mabel goes first this time.'), "the log doesn't say who goes first");
}
assert.equal(await sheetOpen(), false, "Founders' Day stays open over the new game");
assert.equal(await page.$eval('#app', el => el.inert), false, "the new game is inert after Founders' Day's sheet");

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

// On a phone the players are one row of compact cards that keep the same rows, whatever the amounts: piece and name,
// cash, then worth or what they owe. That leaves the board the whole width, standing as tall as the screen has room for
// (taller than a square board by half again on a phone with height to spare), with the newest line of What happened
// still on screen and no page to scroll. Everyone holds two detours, as at the start of a game, and the cash keeps clear
// of them.
await scene('s.players[0].cash = 12345; s.players[1].cash = 1000; s.players[2].cash = 0; s.players[2].debt = 1230; s.players[3].cash = 8888; s.players.forEach(p => { p.detours = 2; }); for (let k = 1; k <= 8; k++) s.log.push(`Rusty paid Dot $120 rent on Tannery Lane (${k}).`);');
for (const [width, height] of [[390, 844], [375, 667], [360, 780], [430, 932], [320, 568]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(200);
  const chips = await page.$$eval('.chip', cs => cs.map(c => ({ h: c.offsetHeight, top: Math.round(c.getBoundingClientRect().top), text: c.textContent.replace(/\s+/g, ' ').trim() })));
  assert.equal(new Set(chips.map(c => c.h)).size, 1, `player cards differ in height at ${width}px: ${JSON.stringify(chips)}`);
  assert.equal(new Set(chips.map(c => c.top)).size, 1, `the player cards are not in one row at ${width}px: ${JSON.stringify(chips)}`);
  assert.deepEqual(await page.$$eval('.chip .nm, .chip .sub, .chip .cash', es => es.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)), [], `card text is cut off at ${width}px`);
  assert.match(chips[2].text, /owes \$1,230/, 'a card with a loan says what is owed');
  assert.deepEqual(await page.$$eval('.chip', cs => cs.filter(c => {
    const r = document.createRange();
    r.selectNodeContents(c.querySelector('.cash'));
    return r.getBoundingClientRect().right > c.querySelector('.dt').getBoundingClientRect().left - 2;
  }).map(c => c.querySelector('.cash').textContent)), [], `the cash runs into the detours at ${width}px`);
  const m = await page.evaluate(() => ({ board: document.querySelector('.board-wrap').getBoundingClientRect().toJSON(), units: document.getElementById('board').viewBox.baseVal.height,
    doc: document.documentElement.scrollHeight, newest: document.querySelector('#log li:first-child').getBoundingClientRect().bottom, log: document.getElementById('log').getBoundingClientRect().bottom }));
  if (width >= 360) assert.ok(m.board.width >= width - 16, `the board is ${m.board.width} px wide at ${width}x${height}, not the screen's width less its edges`);
  else assert.ok(m.board.width >= 285, `the board is only ${m.board.width} px wide at ${width}x${height}`);
  assert.ok(m.units >= 1140 && m.units <= 1400, `the board is ${m.units} units tall at ${width}x${height}`);
  if (height >= 780) assert.equal(m.units, 1400, `the board doesn't stand as tall as it can at ${width}x${height}`);
  assert.ok(m.doc <= height, `the page scrolls ${m.doc - height} px at ${width}x${height}`);
  assert.ok(m.newest <= height, `the newest line of What happened is below the fold at ${width}x${height}`);
  if (height >= 780) assert.ok(height - m.log < 40, `${Math.round(height - m.log)} px of empty felt under What happened at ${width}x${height}`);
}
await page.setViewportSize({ width: 390, height: 844 });

// A tap on a piece reaches the space it stands on: the lot's sheet opens.
await scene('s.players[0].pos = 17;');
{
  const box = await page.$eval('#board .tokens', g => { const r = [...g.children].at(-1).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(box.x, box.y);
  assert.equal(await sheetOpen(), true, 'a tap on a piece opens nothing');
  assert.match(await page.textContent('#sheet h2'), /High Street Corner/);
  await page.click('#sheet [data-close]');
}

// The tall board's tags are big enough to read on a phone, written like every other amount ($1,440), and stay
// inside their cells; the Payday corner says what Payday pays. A rent tag carries a copy of its owner's piece, inside
// the tag and clear of the amount, so an owner shows by shape as well as colour (a price tag has none). The Gazette
// says NEWS and the Assessor TAX under their drawings, as the Lumberyard says BUILD ½.
await scene("B.LOTS_IN.bank.forEach(i => { s.owner[i] = 3; s.level[i] = 3; }); s.land.bank = 1.6;");
{
  const st = await page.evaluate(() => { const s = window.boomtown.state; return { owner: s.owner, tokens: s.players.map(p => p.token) }; });
  const tags = await page.$$eval('#board .cell', cells => cells.flatMap(c => {
    const t = c.querySelector('text.pill');
    if (!t) return [];
    const cell = c.querySelector('.bg').getBBox(), tag = t.previousElementSibling.getBoundingClientRect(), box = c.querySelector('.bg').getBoundingClientRect();
    const piece = c.querySelector('.owner'), pb = piece?.getBoundingClientRect(), tb = t.getBoundingClientRect();
    return [{ i: +c.dataset.i, text: t.textContent, size: parseFloat(getComputedStyle(t).fontSize), inside: tag.left >= box.left - 0.5 && tag.right <= box.right + 0.5, w: cell.width,
      piece: piece ? piece.innerHTML : null, pieceIn: pb && pb.left >= tag.left && pb.right <= tb.left + 0.5 && pb.top >= tag.top - 0.5 && pb.bottom <= tag.bottom + 0.5 }];
  }));
  const big = tags.filter(t => t.text.replace(/\D/g, '') >= 1000);
  assert.ok(big.length && big.every(t => /^\$\d{1,3}(,\d{3})+$/.test(t.text)), `amounts of $1,000 and more on the board have no comma: ${JSON.stringify(big)}`);
  assert.deepEqual(tags.filter(t => !t.inside), [], 'a tag reaches outside its cell');
  // Short amounts at 26 units; a rent tag in a space 100 across gives up a little to its piece.
  assert.ok(tags.filter(t => t.text.length <= 5).every(t => t.size >= (t.piece && t.w < 150 ? 24 : 26)), `short tags on the tall board are small: ${JSON.stringify(tags)}`);
  const pieces = await page.evaluate(() => [0, 1, 2, 3].map(k => { const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.innerHTML = window.boomtown.art.token(k, '#fffaf0'); return g.innerHTML; }));
  const owned = tags.filter(t => st.owner[t.i] >= 0);
  assert.ok(owned.length >= 8, 'the scene has few owned lots');
  for (const t of tags) {
    assert.equal(t.piece, st.owner[t.i] >= 0 ? pieces[st.tokens[st.owner[t.i]]] : null, `the tag on space ${t.i} does not carry its owner's piece`);
    if (t.piece) assert.equal(t.pieceIn, true, `the piece on space ${t.i}'s tag is outside the tag or over its amount`);
  }
  assert.equal(await page.textContent('#board .cell[data-i="0"] .corner-sub'), '$' + await page.evaluate(() => window.boomtown.G.RULES.salary));
  assert.deepEqual(await page.$$eval('#board .cell[data-i="3"] .tiny, #board .cell[data-i="16"] .tiny, #board .cell[data-i="23"] .tiny, #board .cell[data-i="10"] .tiny', ts => ts.map(t => t.textContent)),
    ['NEWS', 'BUILD ½', 'NEWS', 'TAX']);
}

// On a small phone the buttons in the middle of the board keep to one line each.
await page.setViewportSize({ width: 375, height: 667 });
await scene("s.phase = 'manage'; s.dice = [1, 2];");
assert.deepEqual(await page.$$eval('#actions .row button', bs => bs.filter(b => { const r = document.createRange(); r.selectNodeContents(b); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1; }).map(b => b.textContent)),
  [], 'a button in the middle of the board wraps onto two lines at 375 px');

// The same small phone choosing a move whose buttons run long (every lot a block of Rusty's, the land as high as it
// goes, Payday on the way): the dice stay clear of the line under them and of the buttons, nothing in the middle
// spills onto the spaces round it, and the detours line keeps to one line. Measured on each die, not the dice's box,
// which is what used to shrink under them.
await scene(`B.OWNABLE.forEach(i => { if (B.SPACES[i].type === 'lot') { s.owner[i] = 1; s.level[i] = 3; } }); for (const d in s.land) s.land[d] = G.RULES.landMax;
  s.players[0].pos = 24; s.players[0].detours = 2;
  for (let r = 1; ; r++) { const t = { ...s, rng: r }; G.roll(t); if (t.dice[0] === 1 && t.dice[1] === 5) { s.rng = r; break; } }`);
await page.click('#actions button:has-text("Roll the dice")');
await page.waitForSelector('.move-btn');
await page.waitForTimeout(300);
// The same, with the phone held sideways, at the sizes of common phones: the board stands on the left as tall as the
// screen allows, the header, every player's card and the newest line of What happened are beside it, and nothing
// scrolls.
for (const [width, height] of [[375, 667], [667, 375], [844, 390], [932, 430], [740, 360], [568, 320]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(200);
  const at = `${width}x${height}`;
  const m = await page.evaluate(() => {
    const box = e => e.getBoundingClientRect();
    const hit = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5;
    const c = box(document.getElementById('center')), say = box(document.getElementById('say')), act = box(document.getElementById('actions'));
    const dice = [...document.querySelectorAll('#dice .die')].map(box);
    const det = document.querySelector('#actions .detours'), r = document.createRange();
    r.selectNodeContents(det);
    const board = box(document.querySelector('.board-wrap'));
    const seen = e => { const b = box(e); return b.top >= -0.5 && b.left >= -0.5 && b.bottom <= innerHeight + 0.5 && b.right <= innerWidth + 0.5; };
    return {
      dice: dice.length, over: dice.some(d => hit(d, say) || hit(d, act)),
      out: [...document.getElementById('center').children].filter(e => e.getClientRects().length).filter(e => { const b = box(e); return b.top < c.top - 0.5 || b.bottom > c.bottom + 0.5 || b.left < c.left - 0.5 || b.right > c.right + 0.5; }).map(e => e.id),
      lines: new Set([...r.getClientRects()].map(x => Math.round(x.top))).size, det: det.textContent, say: document.getElementById('say').textContent,
      long: [...document.querySelectorAll('.move-btn')].filter(b => /passing Payday/.test(b.textContent)).length,
      board: board.toJSON(), side: box(document.querySelector('.side')).toJSON(), scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      hidden: [document.querySelector('.top'), ...document.querySelectorAll('.chip, #log li:first-child, .board-wrap')].filter(e => !seen(e)).map(e => e.className || e.textContent),
    };
  });
  assert.equal(m.say, 'Move by both dice, or take a detour by one.');
  assert.equal(m.long, 2, 'the scene has lost its long move buttons');
  assert.equal(m.dice, 2);
  assert.equal(m.over, false, `the dice are drawn over the line or the move buttons at ${at}`);
  assert.deepEqual(m.out, [], `the middle of the board spills onto the spaces round it at ${at}`);
  assert.equal(m.det, 'Detours ◆◆ (all you can hold)', 'the detours line at two says Payday gives one back');
  assert.equal(m.lines, 1, `the detours line wraps at ${at}: ${m.det}`);
  assert.deepEqual(m.scroll, [width, height], `the page scrolls at ${at}`);
  assert.deepEqual(m.hidden, [], `part of the play screen is off the screen at ${at}`);
  if (width > height) {
    assert.ok(m.board.right <= m.side.left, `the players are not beside the board at ${at}`);
    assert.ok(m.board.height >= height - 16, `the board is only ${m.board.height} px tall at ${at}`);
  }
}
// A long Since your turn in the last round, where the middle of the board is shortest: the note gives way and
// scrolls, so it, the line over it and Roll the dice stay inside the middle, and none of the note is lost.
for (const [width, height] of [[568, 320], [740, 360], [844, 390], [320, 568]]) {
  await page.setViewportSize({ width, height });
  await scene(`s.round = s.rounds; for (const i of [1, 15, 17, 18]) s.owner[i] = 0;
    s.since = []; s.since[0] = [{ t: 'rent', from: 1, amount: 275, loan: 0 }, { t: 'rent', from: 2, amount: 465, loan: 100 }, { t: 'rent', from: 3, amount: 1230, loan: 0 },
      { t: 'land', d: 'main', from: 1, to: 1.2 }, { t: 'land', d: 'mill', from: 1, to: 0.85 }];`);
  const m = await page.evaluate(() => {
    const c = document.getElementById('center').getBoundingClientRect(), since = document.querySelector('#actions .since');
    return {
      out: [...document.querySelectorAll('#center > *, #actions > *')].filter(e => e.getClientRects().length).filter(e => { const b = e.getBoundingClientRect(); return b.top < c.top - 0.5 || b.bottom > c.bottom + 0.5; }).map(e => e.id || e.className),
      text: since.textContent, lines: since.clientHeight / parseFloat(getComputedStyle(since).lineHeight),
    };
  });
  assert.match(m.text, /^Since your turn: Rusty paid you \$275\. .* And 1 more: see what happened\.$/, `the scene has lost its long note at ${width}x${height}`);
  assert.deepEqual(m.out, [], `a long Since your turn pushes the middle of the board onto the spaces round it at ${width}x${height}`);
  assert.ok(m.lines >= 2, `a long Since your turn shows under two lines at ${width}x${height}`);
}
await page.setViewportSize({ width: 375, height: 667 });
await scene("s.players[0].detours = 1; s.dice = [2, 5]; s.phase = 'move';");
assert.equal(await page.textContent('#actions .detours'), 'Detours ◆ · one back at Payday');

// With four players, the newest line of What happened is on screen, and the page doesn't scroll.
await scene("for (let k = 1; k <= 8; k++) s.log.push(`Rusty paid Dot $120 rent on Tannery Lane (${k}).`);");
{
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, newest: document.querySelector('#log li:first-child').getBoundingClientRect().bottom, text: document.querySelector('#log li:first-child').textContent }));
  assert.equal(m.text, 'Rusty paid Dot $120 rent on Tannery Lane (8).');
  assert.ok(m.doc <= 667, `the page scrolls ${m.doc - 667} px at 375x667 with four players`);
  assert.ok(m.newest <= 667, 'the newest line of What happened is below the fold at 375x667');
}
await page.setViewportSize({ width: 390, height: 844 });
assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'the page scrolls at 390x844 with four players');

// Dice emptied between turns forget what they showed: a roll of the same pair as the last one shown is still drawn.
await scene("s.dice = [2, 5]; s.phase = 'move';");
await page.evaluate(() => { const b = window.boomtown, s = b.state; s.dice = null; s.phase = 'roll'; b.render(); s.dice = [2, 5]; s.phase = 'move'; b.render(); });
assert.equal(await page.$$eval('#dice .die', ds => ds.length), 2, 'a roll of the same pair as the last dice shown is not drawn');

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
// Rent paid floats off both pieces, out of the payer's and into the owner's (whose card lights up), and money floating
// off a space on the board's top row stays on the board.
await page.setViewportSize({ width: 390, height: 844 });
await scene(RENT);
await page.waitForSelector('#sheet [data-c="pay"]');
await page.evaluate(() => {
  window.seen = { floats: [], flash: [] };
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.classList?.contains('float')) window.seen.floats.push({ text: n.textContent, fill: n.getAttribute('fill'), el: n });
  }))).observe(document.querySelector('#board .fx'), { childList: true });
  new MutationObserver(() => document.querySelectorAll('.chip.flash').forEach(c => window.seen.flash.push([...c.parentNode.children].indexOf(c))))
    .observe(document.getElementById('players'), { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
});
{
  const { owner, rent } = await page.evaluate(() => window.boomtown.state.pending);
  await page.click('#sheet [data-c="pay"]');
  await page.waitForTimeout(800);
  const seen = await page.evaluate(() => {
    const board = document.getElementById('board').getBoundingClientRect();
    return { floats: window.seen.floats.map(f => ({ text: f.text, fill: f.fill, inside: f.el.isConnected ? f.el.getBoundingClientRect().top >= board.top : null })), flash: window.seen.flash };
  });
  const amount = '$' + rent.toLocaleString('en-US');
  assert.ok(seen.floats.some(f => f.text === '−' + amount), `no −${amount} off the payer: ${JSON.stringify(seen)}`);
  assert.ok(seen.floats.some(f => f.text === '+' + amount && f.fill === '#1f7a46'), `no green +${amount} into the owner: ${JSON.stringify(seen)}`);
  assert.ok(seen.flash.includes(owner), "the owner's card doesn't light up when rent comes in");
  assert.ok(seen.floats.every(f => f.inside !== false), `money floating off the top row leaves the board: ${JSON.stringify(seen)}`);
}

// A huge rent, here $900 when the payer is worth not much more than twice that, floats bigger and shakes the payer's card.
await scene(RENT + ' s.pending.rent = 900; s.players[0].cash = 1000; s.players[0].debt = 0;');
await page.waitForSelector('#sheet [data-c="pay"]');
{
  await page.evaluate(() => {
    window.huge = { floats: [], shook: [] };
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList?.contains('float')) window.huge.floats.push([n.textContent, n.getAttribute('class')]); })))
      .observe(document.querySelector('#board .fx'), { childList: true });
    new MutationObserver(() => document.querySelectorAll('.chip.shake').forEach(c => window.huge.shook.push([...c.parentNode.children].indexOf(c))))
      .observe(document.getElementById('players'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await page.click('#sheet [data-c="pay"]');
  await page.waitForFunction(() => !window.boomtown.busy);
  const huge = await page.evaluate(() => window.huge);
  assert.ok(huge.floats.some(([text, cls]) => text === '−$900' && cls === 'float big'), `a huge rent doesn't float bigger: ${JSON.stringify(huge)}`);
  assert.deepEqual([...new Set(huge.shook)], [0], `a huge rent doesn't shake the payer's card, and only theirs: ${JSON.stringify(huge)}`);
}

// The cards change as the story plays out, not the moment a move is made: on a move past Payday the card keeps its
// cash while the piece is on its way, and shows the pay once it's there.
await scene("s.players[0].pos = 26; s.players[0].debt = 0; s.dice = [3, 4]; s.phase = 'move';");
{
  const [then, early] = await page.evaluate(() => {
    const cash = () => document.querySelector('#players .chip .cash').textContent;
    const was = cash();
    document.querySelector('.move-btn').click(); // both dice, 7, past Payday
    return [was, cash()];
  });
  assert.equal(early, then, `the card shows ${early} the moment the move is made, before the piece reaches Payday (it had ${then})`);
  await page.waitForFunction(() => !window.boomtown.busy);
  const [cash, card] = await page.evaluate(() => [window.boomtown.state.players[0].cash, document.querySelector('#players .chip .cash').textContent]);
  assert.equal(card, '$' + cash.toLocaleString('en-US'), "the card doesn't catch up with the cash once the move has been shown");
  assert.notEqual(card, then, 'passing Payday paid nothing');
}

// The buy sheet's rents are what the lot will earn once bought: here Mill Row's other two lots have a house each, so
// the street's bonus counts, as it does in the rent paid. Its rows for a house and up count the land each build raises.
await scene(`const lots = B.LOTS_IN.mill; lots.forEach(i => { s.owner[i] = -1; s.level[i] = 0; });
  s.owner[lots[1]] = 1; s.level[lots[1]] = 1; s.owner[lots[2]] = 2; s.level[lots[2]] = 1;
  s.players[0].pos = lots[0]; s.phase = 'decide'; s.dice = [1, 1];
  s.pending = { kind: 'buy', at: lots[0], price: G.landValue(s, lots[0]) };`);
{
  if (!await sheetOpen()) await page.click('#actions button:has-text("Decide")');
  await page.waitForSelector('#sheet [data-c="buy"]');
  const { shown, real } = await page.evaluate(() => {
    const s = window.boomtown.state, { G } = window.boomtown, i = s.pending.at;
    // Bought, then built up to each level, each level putting the land up as a build does.
    const real = [0, 1, 2, 3].map(lv => G.rentFor({ ...s, land: { ...s.land, mill: +(s.land.mill + lv * G.RULES.rise).toFixed(3) }, owner: { ...s.owner, [i]: 0 }, level: { ...s.level, [i]: lv } }, i, lv));
    return { shown: [...document.querySelectorAll('#sheet .facts td:last-child')].map(td => td.textContent), real: real.map(n => '$' + n.toLocaleString('en-US')) };
  });
  assert.deepEqual(shown, real, "the buy sheet's rents are not what the lot earns once bought");
  await page.click('#sheet [data-c="pass"]');
}

// City Hall: each district's row says where its land goes, and one already as high as land goes says so and can still
// be picked. A pick puts the land up by RULES.hall, and the line says from what to what, or that nothing moved.
const HALL = "s.players[0].pos = 21; s.dice = [1, 2]; s.phase = 'decide'; s.pending = { kind: 'hall' }; s.land.mill = 1.22; s.land.hill = G.RULES.landMax;";
for (const [d, line] of [['mill', 'You rezoned Mill Row: land up from 122% to 142%.'], ['hill', 'You rezoned Hilltop: its land was already as high as land goes.']]) {
  await scene(HALL);
  await page.waitForSelector('#sheet [data-c="mill"]');
  assert.match(await page.textContent('#sheet [data-c="mill"] small'), /^Land at 122% → 142%/, "City Hall's row doesn't say where the land goes");
  assert.match(await page.textContent('#sheet [data-c="hill"] small'), /^Land at 300%, as high as it goes/, "City Hall's row for a district at the top doesn't say so");
  assert.equal(await page.$eval('#sheet [data-c="hill"]', b => b.disabled), false, 'a district at the top cannot be picked at City Hall');
  const was = await page.evaluate(d => window.boomtown.state.land[d], d);
  await page.click(`#sheet [data-c="${d}"]`);
  await page.waitForFunction(() => window.boomtown.state.phase === 'manage' && !window.boomtown.busy);
  const { land, log } = await page.evaluate(d => ({ land: window.boomtown.state.land[d], log: window.boomtown.state.log }), d);
  const { hall, landMax } = await page.evaluate(() => window.boomtown.G.RULES);
  assert.equal(land, Math.min(landMax, Math.round((was + hall) * 1000) / 1000), `City Hall moved ${d} from ${was} to ${land}`);
  assert.ok(log.includes(line), `no "${line}" in the log: ${log.slice(-4)}`);
}

// Each question says what cash you have to answer it with, once (the sheet covers the player cards on a phone), and a
// real choice on each does what it says.
{
  const usd = n => '$' + n.toLocaleString('en-US');
  const state = () => page.evaluate(() => window.boomtown.state);
  const ask = async sel => { if (!await sheetOpen()) await page.click('#actions button:has-text("Decide")'); await page.waitForSelector(sel); };
  const settled = () => page.waitForFunction(() => window.boomtown.state.phase === 'manage' && !window.boomtown.busy && document.getElementById('sheetWrap').hidden);
  const have = () => page.$$eval('#sheet .have', es => es.map(e => e.textContent));
  const EMPTY = "B.LOTS_IN.mill.forEach(i => { s.owner[i] = -1; s.level[i] = 0; }); s.dice = [1, 2]; s.phase = 'decide';";

  // Buy: "You have $400; $35 left after.", and the answers stay in view on a small phone. Short of the price, or with a
  // loan, it says what you have and owe.
  const BUY = cash => `${EMPTY} const i = B.LOTS_IN.mill[0]; s.players[0].pos = i; s.players[0].cash = ${cash}; s.pending = { kind: 'buy', at: i, price: G.landValue(s, i) };`;
  await page.setViewportSize({ width: 375, height: 667 });
  await scene(BUY(400));
  await ask('#sheet [data-c="buy"]');
  {
    const { pending } = await state();
    assert.deepEqual(await have(), [`You have $400; ${usd(400 - pending.price)} left after.`], "the buy sheet doesn't say what you have and what's left");
    assert.deepEqual(await page.$$eval('#sheet [data-c]', bs => bs.filter(b => { const r = b.getBoundingClientRect(); return r.top < 0 || r.bottom > innerHeight; }).map(b => b.textContent)), [],
      "the buy sheet's answers are out of view at 375x667");
    await page.click('#sheet [data-c="buy"]');
    await settled();
    const t = await state();
    assert.deepEqual([t.owner[pending.at], t.players[0].cash], [0, 400 - pending.price], 'buying a lot');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await scene(BUY(20));
  await ask('#sheet [data-c="buy"]');
  assert.deepEqual(await have(), ['You have $20.'], 'the buy sheet short of the price');
  await scene(BUY(0) + ' s.players[0].debt = 120;');
  await ask('#sheet [data-c="buy"]');
  assert.deepEqual(await have(), ['You have $0 and owe the bank $120.'], 'the buy sheet with a loan');
  await page.click('#sheet [data-c="pass"]');
  await settled();

  // Rent: "You have $X." With a forced sale it won't stretch to, the cash starts that sale's note; short of the rent,
  // it says how short. A forced sale moves the lot.
  for (const [cash, says] of [['s.pending.buyout + 100', p => [`You have ${usd(p.buyout + 100)}.`]], ['s.pending.buyout - 5', p => [`You have ${usd(p.buyout - 5)}.`]], ['0', p => [`You have $0, so you're ${usd(p.rent)} short.`]]]) {
    await scene(`${RENT} s.players[0].cash = ${cash};`);
    await ask('#sheet [data-c="pay"]');
    const { pending } = await state();
    const shown = (await have()).map(t => t.replace(/ The bank lends.*/, ''));
    assert.deepEqual(shown, says(pending), `the rent sheet with ${cash} doesn't say what you have, once`);
    if (cash === 's.pending.buyout - 5') assert.match(await page.textContent('#sheet [data-c="buyout"] + .note'), /^You have \$[\d,]+\. Nothing is built here/, "a forced sale greyed out for want of cash doesn't say what you have");
    if (cash === '0') assert.ok((await page.textContent('#sheet .have')).includes('adds a tenth, rounded up to the next $5 (at least $5), each time you pass Payday'), "the rent sheet doesn't say how a loan's interest is reckoned");
    if (cash === 's.pending.buyout + 100') {
      await page.click('#sheet [data-c="buyout"]');
      await settled();
      const t = await state();
      assert.deepEqual([t.owner[pending.at], t.players[0].cash], [0, 100], 'a forced sale');
    }
  }

  // The Land Office sells a named lot at its land value; the Estate sale at half that, to the $5.
  for (const kind of ['office', 'estate']) {
    await scene(`${EMPTY} s.players[0].pos = ${kind === 'office' ? 7 : 3}; s.players[0].cash = 1000; s.land.mill = 1.25; s.pending = { kind: '${kind}' };`);
    const i = await page.evaluate(() => window.boomtown.state && (window.lot = [2, 1, 4].find(j => window.boomtown.state.owner[j] < 0)));
    await ask(`#sheet [data-c="${i}"]`);
    assert.deepEqual(await have(), ['You have $1,000.'], `the ${kind} sheet doesn't say what you have`);
    const value = await page.evaluate(i => window.boomtown.G.landValue(window.boomtown.state, i), i);
    const price = kind === 'office' ? value : Math.round(value / 2 / 5) * 5;
    assert.equal(await page.textContent(`#sheet [data-c="${i}"] .cost`), usd(price), `the ${kind} sheet's price`);
    await page.click(`#sheet [data-c="${i}"]`);
    await settled();
    const t = await state();
    assert.deepEqual([t.owner[i], t.players[0].cash], [0, 1000 - price], `buying at the ${kind}`);
  }

  // The Lumberyard builds a level at half its cost.
  await scene(`${EMPTY} const i = B.LOTS_IN.mill[1]; s.owner[i] = 0; s.players[0].pos = 10; s.players[0].cash = 300; s.pending = { kind: 'yard' }; window.lot = i;`);
  {
    const i = await page.evaluate(() => window.lot);
    await ask(`#sheet [data-c="${i}"]`);
    assert.deepEqual(await have(), ['You have $300.'], "the Lumberyard doesn't say what you have");
    const cost = await page.evaluate(i => Math.round(window.boomtown.G.buildCost(i) / 2), i);
    await page.click(`#sheet [data-c="${i}"]`);
    await settled();
    const t = await state();
    assert.deepEqual([t.level[i], t.players[0].cash], [1, 300 - cost], 'building at the Lumberyard');
  }
}

await scene();
await page.click('#board .cell[data-i="17"]');
assert.equal(await page.$$eval('#board .focus-ring', r => r.length), 1, 'a tapped space is not ringed on the board');
await page.click('#sheet [data-close]');
assert.equal(await page.$$eval('#board .focus-ring', r => r.length), 0, 'the ring stays after the sheet closes');
// The Assessor's sheet, and the board as a screen reader hears it, say what it charges.
{
  const { taxPerLevel, taxMin } = await page.evaluate(() => window.boomtown.G.RULES);
  const charge = `$${taxPerLevel} for every building level you own, and never less than $${taxMin}, into the kitty.`;
  const tax = await page.evaluate(() => [...document.querySelectorAll('#board .cell')].find(c => /^Assessor/.test(c.getAttribute('aria-label')))?.dataset.i);
  assert.ok((await page.getAttribute(`#board .cell[data-i="${tax}"]`, 'aria-label')).includes(`Assessor: pay ${charge}`), "the Assessor's label doesn't say what it charges");
  await page.click(`#board .cell[data-i="${tax}"]`);
  assert.ok((await page.textContent('#sheet')).includes(`Pay ${charge}`), "the Assessor's sheet doesn't say what it charges");
  await page.click('#sheet [data-close]');
}

// The person playing the townsfolk alone is called You, and the game talks to them: a lot of theirs is "Your house",
// on the board and on its sheet, never "You's house" or "You owns".
await scene();
{
  const i = await page.evaluate(() => { const s = window.boomtown.state; return Object.keys(s.owner).map(Number).find(j => s.owner[j] === 0 && s.level[j] > 0); });
  assert.match(await page.getAttribute(`#board .cell[data-i="${i}"]`, 'aria-label'), /\. Your (house|shop|block), rent \$/, "a lot of yours is read out as You's");
  await page.click(`#board .cell[data-i="${i}"]`);
  assert.doesNotMatch(await page.textContent('#sheet'), /You's|You owns/, "your lot's sheet says You's");
  await page.click('#sheet [data-close]');
}

// Your lots sells a building only on a second tap: the first turns "Sell $30" into "Sure? +$30" for a few seconds.
// The line after says what the sale did to the district's land.
await scene("const i = B.LOTS_IN.mill[0]; s.owner[i] = 0; s.level[i] = 2; s.land.mill = 1.2; s.phase = 'manage'; s.dice = [1, 2]; window.sold = i;");
{
  await page.click('#actions button:has-text("Build"), #actions button:has-text("Your lots")');
  const level = () => page.evaluate(() => window.boomtown.state.level[window.sold]);
  const b = `#sheet [data-sell="${await page.evaluate(() => window.sold)}"]`;
  assert.match(await page.textContent(b), /^Sell \$\d+$/, 'the sell button has no words');
  await page.click(b);
  assert.equal(await level(), 2, 'one tap sold the building');
  assert.match(await page.textContent(b), /^Sure\? \+\$\d+$/, 'the first tap does not ask');
  await page.waitForTimeout(3300);
  assert.match(await page.textContent(b), /^Sell \$\d+$/, 'Sure? stays after a few seconds');
  await page.click(b);
  await page.click(b);
  await page.waitForFunction(() => window.boomtown.state.level[window.sold] === 1);
  await page.waitForTimeout(800);
  assert.match(await page.textContent('#say'), /^You sold the shop on Tannery Lane back for \$\d+\. Mill Row land fell 8%\.$/, "the sale doesn't say what it did to the land");
  await page.click('#sheet [data-close]');
}
// The same with a loan, where the sale's money goes to the bank first: the line still says what it did to the land.
await scene("const i = B.LOTS_IN.mill[0]; s.owner[i] = 0; s.level[i] = 2; s.land.mill = 1.2; s.players[0].debt = 20; s.phase = 'manage'; s.dice = [1, 2]; window.sold = i;");
{
  await page.click('#actions button:has-text("Build"), #actions button:has-text("Your lots")');
  const b = `#sheet [data-sell="${await page.evaluate(() => window.sold)}"]`;
  await page.click(b);
  await page.click(b);
  await page.waitForFunction(() => window.boomtown.state.level[window.sold] === 1);
  await page.waitForTimeout(800);
  assert.match(await page.textContent('#say'), /^You sold the shop on Tannery Lane back for \$\d+\. Mill Row land fell 8%\.$/, "with a loan, the sale doesn't say what it did to the land");
  await page.click('#sheet [data-close]');
}

// What happened opens on the newest line, at the top, with each round under its own heading, and keeps more than the
// last few rounds.
await scene("s.phase = 'manage'; s.dice = [1, 2]; for (let k = 0; k < 150; k++) s.log.push('Line ' + k);");
{
  await page.click('#actions button:has-text("End turn")');
  await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
  await page.click('#logBtn');
  const { first, header, newest, top, n } = await page.evaluate(() => {
    const s = window.boomtown.state, lis = [...document.querySelectorAll('#sheet ol li')];
    const line = lis.find(l => !l.classList.contains('round'));
    return { first: lis[0].textContent, header: lis[0].classList.contains('round'), newest: line.textContent === s.log.filter(t => !/^Round \d+$/.test(t)).pop(),
      top: line.getBoundingClientRect().top < document.getElementById('sheet').getBoundingClientRect().top + 160, n: lis.length };
  });
  assert.equal(first, 'Round 15', 'What happened does not start with the round now being played');
  assert.equal(header, true, 'the round line is not drawn as a heading');
  assert.equal(newest, true, 'What happened does not list the newest line first');
  assert.equal(top, true, 'the newest line is not at the top of What happened as it opens');
  assert.ok(n > 150, `What happened keeps only ${n} lines`);
  await page.click('#sheet [data-close]');
}

// While the townsfolk play, a tap on a space opens it even mid-animation, and the open sheet holds them up until it's
// closed. Leaving from the menu while they wait doesn't strand the game: carried on, they play on to your turn.
await scene("s.phase = 'manage'; s.dice = [1, 2];");
{
  await page.click('#actions button:has-text("End turn")');
  await page.waitForFunction(() => window.boomtown.busy === true && window.boomtown.state.turn !== 0, null, { timeout: 10000 });
  await page.click('#board .cell[data-i="17"]');
  assert.equal(await sheetOpen(), true, 'a tap while the townsfolk play is ignored');
  const snap = () => page.evaluate(() => { const s = window.boomtown.state; return JSON.stringify([s.turn, s.phase, s.players.map(p => p.pos), s.owner, s.level]); });
  await page.waitForTimeout(1200);
  const held = await snap();
  await page.waitForTimeout(1500);
  assert.equal(await snap(), held, 'the townsfolk play on behind an open sheet');
  await page.click('#sheet [data-close]');
  await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
}
await scene("s.phase = 'manage'; s.dice = [1, 2];");
{
  await page.click('#actions button:has-text("End turn")');
  await page.waitForFunction(() => window.boomtown.state.turn !== 0, null, { timeout: 10000 });
  await page.click('#menuBtn');
  await page.waitForTimeout(800);
  await page.click('#sheet [data-a="leave"]');
  await page.click('#resumeBtn');
  await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.boomtown.state.turn), 0, 'the townsfolk did not play on to your turn after Carry on');
}

// A tap on the middle of the board during a townsperson's turn plays the rest of that turn at once, and the next one
// at the usual pace: here Rusty is hurried and Mabel isn't. Hurry Rusty along, under the line, says so and does the same.
await scene("s.phase = 'manage'; s.dice = [1, 2];");
{
  await page.evaluate(() => {
    window.turns = [];
    let at = null;
    const look = () => { const s = window.boomtown.state; if (s.turn !== at) { at = s.turn; window.turns.push([at, performance.now()]); } requestAnimationFrame(look); };
    look();
  });
  await page.click('#actions button:has-text("End turn")');
  await page.waitForFunction(() => window.boomtown.state.turn === 1 && window.boomtown.busy, null, { timeout: 10000 });
  assert.equal(await page.textContent('#actions .hurry'), 'Hurry Rusty along');
  const box = await page.$eval('.board-wrap', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.4 }; });
  const tapped = await page.evaluate(() => performance.now());
  await page.mouse.click(box.x, box.y);
  assert.equal(await sheetOpen(), false, 'a tap on the middle of the board opened a sheet');
  await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
  const turns = await page.evaluate(() => window.turns);
  const when = seat => turns.find(([p]) => p === seat)?.[1];
  const rusty = when(2) - tapped, mabel = when(3) - when(2);
  assert.ok(rusty < mabel / 2, `hurried, the rest of Rusty's turn took ${Math.round(rusty)} ms, and Mabel's whole turn ${Math.round(mabel)} ms`);
  assert.ok(mabel > 600, `Mabel's turn was hurried too: ${Math.round(mabel)} ms`);
  assert.ok((await page.evaluate(() => window.boomtown.state.log.join(' '))).includes('Rusty rolled'), "the log doesn't say what Rusty did");
}

// A townsperson's Gazette headline shows over the middle of the board, inside it and clear of the spaces round it, so
// where they landed still shows: here Rusty, with no detours, can only move by both dice, onto the Gazette at the top.
await scene("s.turn = 1; s.phase = 'move'; s.dice = [3, 4]; s.players[1].pos = 9; s.players[1].detours = 0; s.deck.unshift('boom-hill');");
{
  await page.waitForSelector('#toast:not([hidden])', { timeout: 10000 });
  const [toast, board, middle] = await page.evaluate(() => ['#toast', '#board', '#center'].map(q => document.querySelector(q).getBoundingClientRect().toJSON()));
  assert.match(await page.textContent('#toast'), /Hilltop/i);
  assert.ok(toast.top >= middle.top && toast.bottom <= middle.bottom && toast.left >= middle.left && toast.right <= middle.right,
    `the townsfolk's headline is not inside the middle of the board: ${JSON.stringify({ toast, middle, board })}`);
  await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
}

// In the menu one tap on Sound or Pace changes it once, however many times the menu has been opened. (Opened twice,
// both end where they started.)
await scene();
for (let k = 0; k < 2; k++) {
  await page.click('#menuBtn');
  for (const [a, key] of [['sound', 'sound'], ['speed', 'speed']]) {
    const b = `#sheet [data-a="${a}"]`;
    const before = [await page.textContent(b), await page.evaluate(key => JSON.parse(localStorage.getItem('boomtown.prefs'))[key], key)];
    await page.click(b);
    const after = [await page.textContent(b), await page.evaluate(key => JSON.parse(localStorage.getItem('boomtown.prefs'))[key], key)];
    assert.notEqual(after[0], before[0], `opened ${k + 1} times, a tap on ${a} doesn't change its label`);
    assert.notEqual(after[1], before[1], `opened ${k + 1} times, a tap on ${a} doesn't change it`);
    if (a === 'sound') assert.equal(await page.getAttribute(b, 'aria-pressed'), String(after[1]), 'Sound is read out as it was before the tap');
  }
  await page.click('#sheet [data-a="back"]');
}
await page.click('#menuBtn');
await page.click('#sheet [data-a="rules"]');
assert.match(await page.textContent('#sheet #sheetTitle'), /How to play/, 'How to play does not open from the menu');
await page.click('#sheet [data-close]');

// When the last turn ends the board shows the finished town a moment, with bunting strung across it, before the special
// edition opens; the bunting stays up behind it.
{
  await scene('s.phase = "over"; window.t0 = performance.now();');
  assert.equal(await page.$$eval('#board .bunting .flag', f => f.length), 14, "Founders' Day has no bunting on the board");
  assert.equal(await sheetOpen(), false, "Founders' Day's edition opens straight away");
  await page.waitForSelector('#sheet .standings li');
  const waited = await page.evaluate(() => performance.now() - window.t0);
  assert.ok(waited >= 1100, `Founders' Day's edition opened ${Math.round(waited)} ms after the last turn, with no moment on the town`);
  await page.click('#sheet [data-close]');
}

// Founders' Day closed any way, by Escape, a tap outside it or its ✕, leaves its headline and See the results on the
// board, which opens it again. A player with a loan is shown owing it, as on their card, never with cash below nothing.
for (const how of ['Escape', 'scrim', '✕']) {
  await scene('s.phase = "over"; s.players[1].cash = 0; s.players[1].debt = 110;');
  await page.waitForSelector('#sheet .standings li');
  const rows = await page.$$eval('#sheet .standings small', es => es.map(e => e.textContent));
  assert.ok(rows.some(r => /^owes \$110 · \$[\d,]+ land · \$[\d,]+ buildings$/.test(r)), `a player with a loan isn't shown owing it: ${rows}`);
  assert.ok(rows.every(r => !r.includes('−')), `Founders' Day shows cash below nothing: ${rows}`);
  if (how === 'Escape') await page.keyboard.press('Escape');
  else if (how === 'scrim') await page.mouse.click(195, 4);
  else await page.click('#sheet [data-close]');
  assert.equal(await sheetOpen(), false, `${how} doesn't close Founders' Day`);
  assert.match(await page.textContent('#say'), /richest in Boomtown\. See the results$/, `closed by ${how}, Founders' Day leaves the board saying ${await page.textContent('#say')}`);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'againLink', `closed by ${how}, the focus isn't on See the results`);
  await page.click('#againLink');
  await page.waitForSelector('#sheet .standings li');
}
await page.click('#sheet [data-a="board"]');
assert.equal(await page.evaluate(() => document.activeElement?.id), 'againLink', 'Look at the town does not leave See the results');

// Your lots keeps its place after a build or a sale: scrolled to the foot of a long list on a small phone, it opens
// again where it was, with the focus back on the lot's own button.
await page.setViewportSize({ width: 375, height: 667 });
await scene("Object.keys(s.owner).forEach(i => { if (B.SPACES[i].type === 'lot') { s.owner[i] = 0; s.level[i] = 1; } }); s.players[0].cash = 20000; s.phase = 'manage'; s.dice = [1, 2];");
{
  const reopened = async i => {
    await page.waitForFunction(i => window.boomtown.state.level[i] !== window.was && !window.boomtown.busy && !document.getElementById('sheetWrap').hidden, i, { timeout: 10000 });
    await page.waitForTimeout(100);
    return page.evaluate(() => ({ top: document.getElementById('sheet').scrollTop, focus: document.activeElement.dataset.build ?? document.activeElement.dataset.sell ?? document.activeElement.className }));
  };
  await page.click('#actions button:has-text("Build"), #actions button:has-text("Your lots")');
  await page.$eval('#sheet', sh => { sh.scrollTop = sh.scrollHeight; });
  const i = await page.$$eval('#sheet [data-build]:not(:disabled)', bs => +bs[bs.length - 1].dataset.build);
  await page.evaluate(i => { window.was = window.boomtown.state.level[i]; }, i);
  await page.click(`#sheet [data-build="${i}"]`);
  const built = await reopened(i);
  assert.ok(built.top > 0, 'Your lots goes back to the top after a build');
  assert.equal(built.focus, String(i), "after a build the focus isn't on the lot's build button");
  await page.$eval('#sheet', sh => { sh.scrollTop = sh.scrollHeight; });
  await page.evaluate(i => { window.was = window.boomtown.state.level[i]; }, i);
  await page.click(`#sheet [data-sell="${i}"]`);
  await page.click(`#sheet [data-sell="${i}"]`);
  const sold = await reopened(i);
  assert.ok(sold.top > 0, 'Your lots goes back to the top after a sale');
  assert.equal(sold.focus, String(i), "after a sale the focus isn't on the lot's sell button");
  await page.click('#sheet [data-close]');
}
await page.setViewportSize({ width: 390, height: 844 });

// In Your lots the build button says Build over its price, not "+$50", which reads as money coming in (as "Sure?
// +$25" does on a sale). At 375 px no row is cut off or reaches outside its box, and Sell keeps to one line.
await page.setViewportSize({ width: 375, height: 667 });
await scene("Object.keys(s.owner).forEach((i, k) => { if (B.SPACES[i].type === 'lot') { s.owner[i] = 0; s.level[i] = k % 3; } }); s.players[0].cash = 20000; s.phase = 'manage'; s.dice = [1, 2];");
{
  await page.click('#actions button:has-text("Build"), #actions button:has-text("Your lots")');
  const builds = await page.$$eval('#sheet [data-build]', bs => bs.map(b => [b.textContent, b.getAttribute('aria-label')]));
  assert.ok(builds.length > 10 && builds.every(([t, l]) => /^Build\$\d+$/.test(t) && /^Build on .+ for \$\d+$/.test(l)), `a build button doesn't say Build: ${JSON.stringify(builds)}`);
  const bad = await page.$$eval('#sheet .pick', rows => rows.flatMap(r => {
    const box = r.getBoundingClientRect(), out = [];
    for (const el of r.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1 || (b.width && (b.right > box.right + 0.5 || b.left < box.left - 0.5))) out.push(el.textContent);
    }
    for (const b of r.querySelectorAll('.sell, .build .kick')) {
      const g = document.createRange(); g.selectNodeContents(b);
      if (new Set([...g.getClientRects()].map(x => Math.round(x.top))).size > 1) out.push(b.textContent);
    }
    return out;
  }));
  assert.deepEqual(bad, [], 'a row of Your lots is cut off at 375 px');
  await page.click('#sheet [data-close]');
}
await page.setViewportSize({ width: 390, height: 844 });

// When land moves, every lot in the district says how far: here a house goes up, and all three lots on its street show
// the land's rise, in green.
await scene(`const i = B.OWNABLE.find(j => B.SPACES[j].type === 'lot' && s.owner[j] < 0 && s.land[B.SPACES[j].district] < 2.5); s.owner[i] = 0;
  s.players[0].cash = 5000; s.players[0].debt = 0; s.phase = 'manage'; s.dice = [1, 2]; window.lot = i;`);
{
  await page.evaluate(() => {
    window.floats = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList?.contains('float')) window.floats.push([n.textContent, n.getAttribute('fill'), n.getAttribute('x'), n.getAttribute('y')]); })))
      .observe(document.querySelector('#board .fx'), { childList: true });
  });
  const lot = await page.evaluate(() => window.lot);
  await page.click(`#board .cell[data-i="${lot}"]`);
  await page.click('#sheet [data-build]');
  await page.waitForFunction(() => !window.boomtown.busy);
  const rise = await page.evaluate(() => Math.round(window.boomtown.G.RULES.rise * 100));
  const floats = (await page.evaluate(() => window.floats)).filter(f => f[0] === `+${rise}%`);
  assert.equal(floats.length, 3, `a building doesn't show the land rising on all three lots of its street: ${JSON.stringify(await page.evaluate(() => window.floats))}`);
  assert.equal(new Set(floats.map(f => f[2] + ',' + f[3])).size, 3, 'the land floats are not on three different lots');
  assert.ok(floats.every(f => f[1] === '#1f7a46'), 'land going up is not shown in green');
}

// The lot that makes a whole district yours brings a banner in the district's colours, over the upper middle of the
// board, saying what owning it all does; What happened says so too. Its words read at 4.5:1 or better.
await scene(`B.LOTS_IN.mill.forEach(j => { s.owner[j] = 0; s.level[j] = 0; }); const i = B.LOTS_IN.mill[2]; s.owner[i] = -1;
  s.players[0].pos = i; s.players[0].cash = 2000; s.dice = [1, 3]; s.phase = 'decide'; s.pending = { kind: 'buy', at: i, price: G.landValue(s, i) };`);
{
  await page.click('#sheet [data-c="buy"]');
  await page.waitForSelector('#banner:not([hidden])', { timeout: 5000 });
  assert.equal(await page.textContent('#banner'), 'You own all of Mill RowRents double on its empty lots.');
  const [ribbon, middle] = await page.evaluate(() => ['#banner', '#center'].map(q => document.querySelector(q).getBoundingClientRect().toJSON()));
  assert.ok(ribbon.top >= middle.top && ribbon.bottom <= middle.top + middle.height / 2 && ribbon.left >= middle.left - 4 && ribbon.right <= middle.right + 4,
    `the banner is not over the upper middle of the board: ${JSON.stringify({ ribbon, middle })}`);
  const ratio = await page.$eval('#banner .ribbon', el => {
    const rgb = c => c.match(/\d+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const L = c => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const cs = getComputedStyle(el), [a, b] = [L(cs.backgroundColor), L(cs.color)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  assert.ok(ratio >= 4.5, `the banner's words read at only ${ratio.toFixed(2)}:1`);
  await page.waitForFunction(() => !window.boomtown.busy);
  assert.ok((await page.evaluate(() => window.boomtown.state.log)).includes('You own all of Mill Row. Rents double on its empty lots.'), "What happened doesn't say you own all of Mill Row");
}

// A lot of yours that a rival could force you to sell says so, in Your lots and on its own sheet.
await scene("const i = B.LOTS_IN.mill[0]; B.LOTS_IN.mill.forEach(j => { s.owner[j] = -1; s.level[j] = 0; }); s.owner[i] = 0; window.bare = i;");
{
  await page.click('#actions button:has-text("Your lots")');
  assert.match(await page.textContent('#sheet'), /Tannery Lane.*Empty: a rival can make you sell for \$\d+/, 'Your lots does not warn about a forced sale');
  await page.click('#sheet [data-close]');
  await page.click(`#board .cell[data-i="${await page.evaluate(() => window.bare)}"]`);
  assert.match(await page.textContent('#sheet'), /A rival who lands here can make you sell it for \$\d+\. Build on it, or own the whole district, to keep it\./, "your lot's sheet does not warn about a forced sale");
  await page.click('#sheet [data-close]');
}

// A move's preview says what will really happen there, and after a detour the line says where you landed: here every
// lot is sold, so the Land Office has nothing to offer, and nothing of yours can go up at the Lumberyard.
await scene("B.OWNABLE.forEach(i => { if (s.owner[i] < 0) s.owner[i] = 1; }); s.players[0].pos = 4; s.players[0].detours = 2; s.dice = [3, 5]; s.phase = 'move';");
{
  await page.evaluate(() => window.boomtown.render());
  const moves = await page.$$eval('.move-btn', bs => bs.map(b => b.textContent));
  assert.ok(moves.some(m => /Land Office: nothing left for sale/.test(m)), `the move to the Land Office promises a buy: ${moves}`);
  await page.click('.move-btn:has-text("Land Office")');
  await page.waitForFunction(() => window.boomtown.state.phase === 'manage');
  await page.waitForTimeout(600);
  assert.match(await page.textContent('#say'), /^You took a detour \(1 left\)\. On the Land Office: nothing left for sale\.$/, 'after a detour the line does not say where you are');
}
await scene("B.OWNABLE.forEach(i => { if (s.owner[i] === 0) s.owner[i] = 1; }); s.players[0].pos = 7; s.dice = [1, 2]; s.phase = 'move';");
{
  await page.evaluate(() => window.boomtown.render());
  const moves = await page.$$eval('.move-btn', bs => bs.map(b => b.textContent));
  assert.ok(moves.some(m => /Lumberyard: nothing to build at half price/.test(m)), `the move to the Lumberyard promises a build: ${moves}`);
}

// A move to a rival's empty lot whose owner you could make sell says so beside the rent, at its price, when you'll
// have the cash on arriving (Payday on the way counts). Not in the final round, where a forced sale only costs worth.
// At 375 px the buttons still fit the middle of the board.
{
  const sale = "for (const i of [1, 2, 25]) { s.owner[i] = 1; s.level[i] = 0; } s.owner[4] = 2; s.owner[26] = 2; s.land.mill = 2; s.players[0].debt = 0; s.players[0].pos = 24; s.players[0].detours = 2; s.dice = [1, 5]; s.phase = 'move';";
  const moves = () => page.$$eval('.move-btn', bs => bs.map(b => b.querySelector('.what').textContent));
  await scene(sale + 's.players[0].cash = 5000;');
  const price = await page.evaluate(() => window.boomtown.G.buyoutPrice(window.boomtown.state, 25));
  assert.ok((await moves()).includes(`Detour, one dieLookout Point: rent $${await page.evaluate(() => window.boomtown.G.rentFor(window.boomtown.state, 25))} to Rusty · or make them sell, $${price.toLocaleString('en-US')}`),
    `a move to a rival's empty lot doesn't offer the forced sale: ${await moves()}`);
  assert.equal((await moves()).filter(m => m.includes('or make them sell')).length, 3);
  // Short of Millrace Yard's and Tannery Lane's price now, but not once Payday has paid on the way there; short of Lookout
  // Point's even so: rent only there.
  const mill = await page.evaluate(() => window.boomtown.G.buyoutPrice(window.boomtown.state, 2));
  await scene(sale + `s.players[0].cash = ${mill - 100};`);
  assert.deepEqual((await moves()).map(m => m.includes('or make them sell')), [true, false, true], 'a forced sale you cannot afford is offered, or Payday on the way is not counted');
  await scene(sale + 's.players[0].cash = 5000; s.round = s.rounds;');
  assert.equal((await moves()).some(m => m.includes('make them sell')), false, 'the final round offers a forced sale in the move preview');
  await page.setViewportSize({ width: 375, height: 667 });
  await scene(sale + 's.players[0].cash = 5000;');
  assert.deepEqual(await page.$$eval('#center > *', (ks, c) => ks.filter(e => e.getClientRects().length).filter(e => { const b = e.getBoundingClientRect(); return b.top < c.top - 0.5 || b.bottom > c.bottom + 0.5; }).map(e => e.id),
    await page.$eval('#center', e => e.getBoundingClientRect().toJSON())), [], 'three forced-sale moves spill out of the middle of the board at 375x667');
  await page.setViewportSize({ width: 390, height: 844 });
}

// Each lot you can build on has its badge on that lot, not piled in a corner of the board.
await scene("[...B.LOTS_IN.river, ...B.LOTS_IN.bank].forEach(i => { s.owner[i] = 0; s.level[i] = 0; }); s.players[0].cash = 5000; s.phase = 'manage'; s.dice = [1, 2];");
await page.waitForTimeout(400);
{
  const badges = await page.$$eval('#board .can-build', bs => bs.map(b => {
    const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const cell = [...document.querySelectorAll('#board .cell .bg')].find(c => { const q = c.getBoundingClientRect(); return x >= q.left && x <= q.right && y >= q.top && y <= q.bottom; });
    return cell ? +cell.closest('.cell').dataset.i : null;
  }));
  const can = await page.evaluate(() => { const { G, state: s } = window.boomtown; return Object.keys(s.owner).map(Number).filter(i => G.canBuild(s, 0, i).ok); });
  assert.deepEqual([...badges].sort((x, y) => x - y), can.sort((x, y) => x - y), 'the build badges are not on the lots you can build on');
}

// After a detour the die not moved by is dimmed, until the next roll. With reduced motion asked for, pieces jump
// rather than hop.
await page.setViewportSize({ width: 390, height: 844 });
await page.emulateMedia({ reducedMotion: 'reduce' });
await scene("s.players[0].detours = 2; s.dice = [2, 5]; s.phase = 'move';");
await page.click('.move-btn:has(.n:text-is("2"))');
await page.waitForTimeout(60);
assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('.tok')).length), 0, 'pieces hop with reduced motion asked for');
await page.waitForTimeout(600);
assert.deepEqual(await page.$$eval('#dice .die', ds => ds.map(d => d.classList.contains('used'))), [false, true], 'after a detour by the 2, the 5 is not dimmed');
await page.emulateMedia({ reducedMotion: 'no-preference' });
await answer();
await page.click('#actions button:has-text("End turn")');
await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
await page.click('#actions button:has-text("Roll the dice")');
await page.waitForSelector('.move-btn');
assert.equal(await page.$$eval('#dice .die.used', ds => ds.length), 0, 'a die stays dimmed after the next roll');

// The last round says so, before Founders' Day arrives.
await scene('s.round = s.rounds;');
assert.equal(await page.textContent('#round'), 'Last round', 'the header does not say it is the last round');
assert.equal(await page.$eval('#round', el => el.classList.contains('last')), true, 'the last round is not marked out');
assert.match(await page.textContent('#say'), /Founders' Day after this round\./, "the last round's first turn doesn't say Founders' Day comes after it");

// Played with the keyboard alone, the focus is always on the next step after each one: Roll the dice, then the first
// move, then the question's answer, then End turn, and Roll the dice again when the turn comes back. It's never dropped
// on the page itself. Tab goes from the menu to the buttons, then the spaces; Enter on a space opens it, and Tab stays
// inside the open sheet (the page behind it is inert) until Escape puts the focus back on the space.
{
  const kc = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const kp = await kc.newPage();
  kp.on('pageerror', e => problems.push(e.message));
  await kp.addInitScript(() => localStorage.setItem('boomtown.prefs', JSON.stringify({ speed: 'fast', sound: false, len: 'short', seats: [{ who: 'you', name: 'You' }, { who: 'mabel' }, { who: 'none' }, { who: 'none' }] })));
  await kp.goto(base);
  const focused = () => kp.evaluate(() => {
    const a = document.activeElement;
    return { tag: a.tagName, text: a.textContent.trim().replace(/\s+/g, ' '), sheet: !!a.closest('#sheet'), move: a.classList.contains('move-btn'), cell: a.classList.contains('cell') ? +a.dataset.i : null };
  });
  const st = () => kp.evaluate(() => { const b = window.boomtown; return { phase: b.state.phase, turn: b.state.turn, busy: b.busy, sheet: !document.getElementById('sheetWrap').hidden }; });
  await kp.focus('#startBtn');
  await kp.keyboard.press('Enter');
  await kp.waitForSelector('#actions button:has-text("Roll the dice")');
  for (let turn = 0; turn < 3; turn++) {
    assert.equal((await focused()).text, 'Roll the dice', `turn ${turn}: the focus is not on Roll the dice: ${JSON.stringify(await focused())}`);
    if (turn === 0) {
      await kp.keyboard.press('Shift+Tab');
      assert.equal(await kp.evaluate(() => document.activeElement.id), 'menuBtn', 'Shift+Tab from Roll the dice does not go to the menu');
      await kp.keyboard.press('Tab');
      assert.equal((await focused()).text, 'Roll the dice', 'Tab from the menu does not go to Roll the dice');
      // The ring is ink with gold inside it, which shows on the cream paper as well as the felt (gold alone is 1.8:1).
      await kp.waitForTimeout(200); // the buttons' shadow eases in
      assert.deepEqual(await kp.evaluate(() => { const c = getComputedStyle(document.activeElement); return [c.outlineColor, c.outlineWidth, /rgb\(226, 178, 60\) 0px 0px 0px 5px/.test(c.boxShadow)]; }),
        ['rgb(42, 36, 32)', '3px', true], 'the focus ring is not ink and gold');
    }
    await kp.keyboard.press('Enter');
    await kp.waitForSelector('.move-btn');
    await until(async () => !(await st()).busy, 5000, 'the roll did not finish');
    assert.equal((await focused()).move, true, `turn ${turn}: after rolling, the focus is not on a move: ${JSON.stringify(await focused())}`);
    await kp.keyboard.press('Enter');
    for (let k = 0; k < 20; k++) {
      await until(async () => { const x = await st(); return x.sheet || (!x.busy && x.phase === 'manage'); }, 10000, 'the move did not finish'); // a Gazette headline is read while the move goes on
      if ((await st()).phase === 'manage' && !(await st()).sheet) break;
      const f = await focused();
      assert.ok(f.sheet, `turn ${turn}: a question is open but the focus is not on it: ${JSON.stringify(f)}`);
      await kp.keyboard.press('Enter');
      await kp.waitForTimeout(300);
    }
    await until(async () => (await focused()).text === 'End turn', 5000, `turn ${turn}: the focus is not on End turn`);
    await kp.keyboard.press('Enter');
    await kp.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
  }
  // Tab on from the buttons to the spaces, Enter on one, and round the sheet that opens.
  for (let k = 0; k < 4 && (await focused()).cell == null; k++) await kp.keyboard.press('Tab');
  const cell = (await focused()).cell;
  assert.notEqual(cell, null, 'Tab from the buttons does not go on to the spaces');
  assert.equal(await kp.$$eval('#board .kbd rect', r => r.length), 2, 'the space with the focus is not ringed');
  await kp.keyboard.press('Enter');
  assert.equal((await st()).sheet, true, 'Enter on a space does not open it');
  assert.equal(await kp.evaluate(() => document.activeElement.id), 'sheetTitle', "a space's sheet does not put the focus on its name");
  for (let k = 0; k < 4; k++) {
    await kp.keyboard.press(k % 2 ? 'Shift+Tab' : 'Tab');
    assert.equal((await focused()).sheet, true, `Tab ${k + 1} goes out of the open sheet: ${JSON.stringify(await focused())}`);
  }
  assert.equal(await kp.$eval('#app', el => el.inert), true, 'the page behind an open sheet is not inert');
  await kp.keyboard.press('Escape');
  assert.equal((await focused()).cell, cell, 'closing the sheet does not put the focus back on the space');
  assert.equal(await kp.$eval('#app', el => el.inert), false, 'the page stays inert after the sheet closes');
  // Leave the table from the menu: the focus goes to Carry on, and carrying on puts it on Roll the dice.
  await kp.click('#menuBtn');
  await kp.click('#sheet [data-a="leave"]');
  assert.equal(await kp.evaluate(() => document.activeElement.id), 'resumeBtn', 'leaving the table does not put the focus on Carry on');
  await kp.keyboard.press('Enter');
  await kp.waitForSelector('#actions button:has-text("Roll the dice")');
  assert.equal((await focused()).text, 'Roll the dice', 'carrying on does not put the focus on Roll the dice');
  assert.equal(await kp.$eval('#app', el => el.inert), false, 'the game is inert after carrying on');
  await kc.close();
}

// The line in the middle of the board is read out as it changes, so each line is written once, not again and again as
// the screen redraws: over a round of the townsfolk's turns, no line is written twice in a row.
await scene("s.phase = 'manage'; s.dice = [1, 2];");
{
  await page.evaluate(() => {
    window.said = [];
    new MutationObserver(ms => ms.forEach(m => window.said.push([...m.addedNodes].map(n => n.textContent).join(''))))
      .observe(document.getElementById('say'), { childList: true, subtree: true, characterData: true });
  });
  await page.click('#actions button:has-text("End turn")');
  await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
  const said = await page.evaluate(() => window.said);
  assert.deepEqual(said.filter((t, k) => k && t === said[k - 1]), [], `a line in the middle is written again: ${JSON.stringify(said)}`);
  assert.ok(said.some(t => /^(Rusty|Mabel|Dot) to [A-Z]/.test(t) || /^(Rusty|Mabel|Dot) to the /.test(t)), `where the townsfolk moved is not said: ${JSON.stringify(said)}`);
}

// Read by a screen reader in the move phase: each space says who stands on it and where a move lands, the badges and
// pieces add no stray numbers, and each player's card says where its player is and whose turn it is.
await scene("s.players[0].detours = 0; s.dice = [2, 5]; s.phase = 'move';");
{
  const s = await page.evaluate(() => { const st = window.boomtown.state; return { pos: st.players.map(p => p.pos), names: st.players.map(p => p.name), moves: window.boomtown.G.moveOptions(st) }; });
  const nodes = await axTree(page);
  const name = n => n.name?.value || '';
  const spaces = nodes.filter(n => n.role?.value === 'button' && /^(.*?)[,.:]/.test(name(n)) && !n.ignored);
  for (const [q, at] of s.pos.entries()) {
    const label = await page.getAttribute(`#board .cell[data-i="${at}"]`, 'aria-label');
    assert.match(label, new RegExp(`Here: .*${s.names[q]}`), `the space ${s.names[q]} is on does not say so: ${label}`);
    assert.ok(spaces.some(n => name(n) === label), `the space ${s.names[q]} is on is not in the accessibility tree as labelled`);
  }
  for (const o of s.moves) {
    const label = await page.getAttribute(`#board .cell[data-i="${o.to}"]`, 'aria-label');
    assert.match(label, new RegExp(`${o.detour ? 'Detour' : 'Both dice'}, ${o.steps}: ${o.usable ? 'lands here' : 'no detours left'}\\.$`), `a move's space does not say where it lands: ${label}`);
  }
  const byId = new Map(nodes.map(n => [n.nodeId, n]));
  const onBoard = n => { for (let x = n; x; x = byId.get(x.parentId)) if (name(x) === 'The board') return true; return false; };
  const stray = nodes.filter(n => !n.ignored && n.role?.value === 'StaticText' && /^\d+$/.test(name(n)) && onBoard(n));
  assert.deepEqual(stray.map(name), [], 'numbers with no words are read out on the board');
  const chips = nodes.filter(n => !n.ignored && n.role?.value === 'group' && /cash/.test(name(n)));
  assert.equal(chips.length, s.names.length, "the players' cards are not named groups");
  assert.match(await page.textContent('.chip.now .vh'), /^Playing now\. On /, 'the card whose turn it is does not say so');
  assert.match(await page.getAttribute('#board .cell[data-i="0"]', 'aria-label'), /^Payday: collect \$150 passing, \$250 landing\./, "Payday's label does not say what it pays");
}

// The moves are drawn alike, so the screen doesn't suggest one: the same cream button, each with its number in the
// colour of its badge on the board (brick for both dice, gold for a detour). A rent is written in the colour of the
// owner's rent tag on the board, and it, the number on brick and the small BOTH DICE read at 4.5:1 or better.
await scene("s.players[0].pos = 4; s.owner[11] = 1; s.owner[8] = 3; s.level[11] = 0; s.level[8] = 0; s.dice = [3, 4]; s.phase = 'move';");
{
  const m = await page.evaluate(() => {
    const rgb = v => v.match(/[\d.]+/g).map(Number).slice(0, 3);
    const lum = ([r, g, b]) => [r, g, b].map(x => x / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((n, x, k) => n + x * [0.2126, 0.7152, 0.0722][k], 0);
    const ratio = (a, b) => { const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x); return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
    const card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    const hex = h => `rgb(${[1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)).join(', ')})`;
    return [...document.querySelectorAll('.move-btn')].map(b => {
      const cs = getComputedStyle(b), n = b.querySelector('.n'), rent = b.querySelector('.rent');
      const to = window.boomtown.G.moveOptions(window.boomtown.state).find(o => String(o.steps) === n.textContent && o.detour === /^Detour/.test(b.querySelector('.what b').textContent)).to;
      const badge = document.querySelector(`#board .badge[data-i="${to}"] circle`), tag = document.querySelector(`#board .cell[data-i="${to}"] text.pill`)?.previousElementSibling;
      return {
        look: [cs.backgroundImage.split(' 7px, ')[1] /* past the coloured edge */, cs.borderTopColor, cs.color, b.className.replace(/\b(both|detour)\b/, '').trim()].join(' | '),
        n: getComputedStyle(n).backgroundColor, badge: badge && getComputedStyle(badge).fill,
        nRatio: ratio(getComputedStyle(n).color, getComputedStyle(n).backgroundColor), kick: ratio(getComputedStyle(b.querySelector('.what b')).color, hex(card)),
        rent: rent && getComputedStyle(rent).color, tag: tag && getComputedStyle(tag).fill, rentRatio: rent && ratio(getComputedStyle(rent).color, hex(card)),
      };
    });
  });
  assert.equal(m.length, 3, 'the scene has lost its three moves');
  assert.equal(new Set(m.map(b => b.look)).size, 1, `the move buttons are not drawn alike: ${JSON.stringify(m.map(b => b.look))}`);
  for (const b of m) assert.equal(b.n, b.badge, "a move's number is not the colour of its badge on the board");
  assert.equal(new Set(m.map(b => b.n)).size, 2, 'both dice and a detour have numbers of the same colour');
  const rents = m.filter(b => b.rent);
  assert.equal(rents.length, 2, 'the scene has lost its two moves that pay rent');
  for (const b of rents) assert.equal(b.rent, b.tag, "a move's rent is not written in the colour of the owner's rent tag");
  assert.ok(m.every(b => b.nRatio >= 4.5 && b.kick >= 4.5) && rents.every(b => b.rentRatio >= 4.5), `the moves' small text reads under 4.5 to 1: ${JSON.stringify(m)}`);
}

// In a stack of pieces, the piece whose turn it is is drawn on top, whatever its seat.
await scene("s.players.forEach(p => { p.pos = 17; });");
assert.equal(await page.$eval('#board .tokens > .tok:last-child', t => t.classList.contains('now')), true, 'the piece whose turn it is is under the others');

// Tapping a space a move reaches makes that move, on its number badge (drawn over the pieces, so they never hide it) or
// anywhere on the space; tapping the badge of a greyed one (a detour with none left) says why not. The move by both dice
// has a badge of its own colour, as its button has.
await scene("s.players[0].detours = 0; s.dice = [2, 5]; s.phase = 'move';");
{
  const moves = await page.evaluate(() => window.boomtown.G.moveOptions(window.boomtown.state));
  const off = moves.find(o => !o.usable), both = moves.find(o => !o.detour);
  assert.equal(await page.$$eval('#board .badge', bs => bs.filter(b => b.closest('svg').querySelector('.tokens').compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).length), 3,
    'the badges are not drawn over the pieces');
  assert.deepEqual(await page.$$eval('#board .badge.both', bs => bs.map(b => +b.dataset.i)), [both.to], 'the move by both dice is not marked as one');
  assert.equal(await page.$eval(`#board .badge[data-i="${both.to}"] circle`, c => getComputedStyle(c).fill === getComputedStyle(document.querySelector('.move-btn.both .n')).backgroundColor), true,
    "the badge of the move by both dice is not the brick of its button's number (a detour's is gold)");
  await page.click(`#board .badge[data-i="${off.to}"] circle`);
  assert.equal(await page.textContent('#say'), 'No detours left until Payday.', 'a greyed badge says nothing when tapped');
  assert.equal(await page.evaluate(() => window.boomtown.state.phase), 'move');
  await page.click(`#board .badge[data-i="${both.to}"] circle`);
  await page.waitForFunction(() => window.boomtown.state.phase !== 'move', null, { timeout: 5000 }).catch(() => {});
  assert.notEqual(await page.evaluate(() => window.boomtown.state.phase), 'move', 'tapping the badge of a move does not make it');
  assert.equal(await page.evaluate(() => window.boomtown.state.players[0].pos), both.to, 'the badge tapped moved somewhere else');
  await page.waitForFunction(() => !window.boomtown.busy);
}
await scene("s.players[0].detours = 2; s.dice = [2, 5]; s.phase = 'move';");
{
  const to = await page.evaluate(() => window.boomtown.G.moveOptions(window.boomtown.state).find(o => o.steps === 2).to);
  const box = await page.$eval(`#board .cell[data-i="${to}"] .bg`, r => { const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height - 8 }; });
  await page.mouse.click(box.x, box.y);
  await page.waitForFunction(() => window.boomtown.state.phase !== 'move', null, { timeout: 5000 }).catch(() => {});
  assert.equal(await page.evaluate(() => window.boomtown.state.players[0].pos), to, 'tapping the space a detour reaches does not move there');
  assert.equal(await page.evaluate(() => window.boomtown.state.players[0].detours), 1, 'the detour tapped did not cost a detour');
  await page.waitForTimeout(800);
  if (await sheetOpen()) await answer();
}

// One person playing the townsfolk under their own name: Carry on says who the game is with, not their name too.
await scene("s.players[0].name = 'Ann';", { round: 4 });
await page.evaluate(() => localStorage.setItem('boomtown.game', JSON.stringify(window.boomtown.state)));
await page.click('#menuBtn');
await page.click('#sheet [data-a="leave"]');
assert.match(await page.textContent('#resumeBtn'), /^Carry on Round 4 of 20, with Rusty, Mabel and Dot$/, "Carry on lists a person playing alone among those they're playing");

// Break ground with a game left unfinished asks before it starts over that game, and Carry on says which game it is.
await scene('', { round: 4 });
await page.evaluate(() => localStorage.setItem('boomtown.game', JSON.stringify(window.boomtown.state)));
{
  const savedRound = () => page.evaluate(() => JSON.parse(localStorage.getItem('boomtown.game')).round);
  await page.click('#menuBtn');
  await page.click('#sheet [data-a="leave"]');
  assert.match(await page.textContent('#resumeBtn'), /^Carry on Round 4 of 20, with Rusty, Mabel and Dot$/, 'Carry on does not say which game it carries on');
  assert.ok(await page.$eval('#startBtn', b => b.getBoundingClientRect().bottom <= innerHeight), 'with Carry on, Break ground is below the fold on a phone');
  await page.click('#startBtn');
  assert.equal(await sheetOpen(), true, 'Break ground starts over a game in progress without asking');
  assert.match(await page.textContent('#sheet'), /Your game in round 4 of 20 will be lost\./);
  assert.equal(await savedRound(), 4, 'Break ground replaced the saved game before it was answered');
  await page.click('#sheet [data-a="keep"]');
  assert.equal(await sheetOpen(), false, 'Keep that game leaves the question open');
  assert.equal(await page.isVisible('#title'), true, 'Keep that game leaves the title screen');
  assert.equal(await savedRound(), 4, 'Keep that game did not keep the game');
  await page.click('#startBtn');
  await page.click('#sheet [data-a="new"]');
  await page.waitForSelector('#actions button:has-text("Roll the dice")');
  assert.equal(await savedRound(), 1, 'Start the new game did not start one');
}

// What the townsfolk did to you while you waited is waiting for you when your turn comes round, even after a reload,
// and goes once you roll: here Dot forces a sale of one of your lots to finish its district, and part of the price
// pays off your loan. As it happens, SOLD is stamped across the lot, and a headline says what you got for it.
await page.evaluate(() => {
  window.sale = { stamps: [], toasts: [] };
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList?.contains('stamp')) window.sale.stamps.push(n.textContent); })))
    .observe(document.querySelector('#board .fx'), { childList: true });
  new MutationObserver(() => { const t = document.getElementById('toast'); if (!t.hidden) window.sale.toasts.push(t.textContent); })
    .observe(document.getElementById('toast'), { childList: true, attributes: true, attributeFilter: ['hidden'] });
});
await scene(`const i = B.OWNABLE.find(j => B.SPACES[j].type === 'lot' && s.level[j] === 0 && s.owner[j] !== 0 && (s.owner[j] = 0, G.buyoutPrice(s, j) != null));
  for (const j of B.LOTS_IN[B.SPACES[i].district]) if (j !== i) s.owner[j] = 3;
  s.players[0].debt = 100; s.players[3].cash = 5000; s.players[3].pos = i;
  s.turn = 3; s.dice = [1, 2]; s.phase = 'decide';
  s.pending = { kind: 'rent', at: i, owner: 0, rent: G.rentFor(s, i), buyout: G.buyoutPrice(s, i) };
  window.lost = i;`);
await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 20000 });
{
  const { name, price } = await page.evaluate(() => {
    const s = window.boomtown.state;
    return { name: window.boomtown.G && document.querySelector(`#board .cell[data-i="${window.lost}"]`).getAttribute('aria-label').split(',')[0], price: s.owner[window.lost] === 3 };
  });
  assert.equal(price, true, 'Dot did not force the sale this scene sets up');
  const sale = await page.evaluate(() => window.sale);
  assert.deepEqual(sale.stamps, ['SOLD'], `a forced sale is not stamped SOLD on the board: ${JSON.stringify(sale)}`);
  const head = sale.toasts.map(x => x.match(new RegExp(`Dot made you sell ${name}\\$([\\d,]+) for land worth \\$([\\d,]+)\\.$`))).find(Boolean);
  assert.ok(head, `no headline says Dot made you sell ${name}: ${JSON.stringify(sale.toasts)}`);
  const [paid, land] = head.slice(1).map(x => +x.replace(/,/g, ''));
  assert.equal(paid, Math.round(land * 1.5 / 5) * 5, `the headline's price and land value don't go together: ${head[0]}`);
  const since = new RegExp(`^Since your turn: Dot made you sell ${name} for \\$[\\d,]+ \\(\\$100 of it went to your loan\\)\\.`);
  assert.match(await page.textContent('#actions .since'), since, 'your turn does not say what happened since your last one');
  assert.match(await page.textContent('#log'), /Dot made you sell/, "the log says 'made You sell'");
  await page.reload();
  await page.click('#resumeBtn');
  await page.waitForSelector('#actions button:has-text("Roll the dice")');
  assert.match(await page.textContent('#actions .since'), since, 'what happened since your turn is lost on a reload');
  await page.click('#actions button:has-text("Roll the dice")');
  await page.waitForSelector('.move-btn');
  assert.equal(await page.$$eval('#actions .since', e => e.length), 0, 'what happened since your turn stays after you roll');
}

// A townsperson who passes on a lot, or pays the rent rather than force a sale, says so in the line and the log, but
// not in what happened since your turn.
await scene(`const i = B.OWNABLE.find(j => B.SPACES[j].type === 'lot' && s.level[j] === 0 && s.owner[j] !== 0);
  s.owner[i] = -1; s.players[1].pos = i; s.players[1].cash = 0;
  s.turn = 1; s.dice = [1, 2]; s.phase = 'decide';
  s.pending = { kind: 'buy', at: i, price: G.landValue(s, i) };
  window.left = B.SPACES[i].name;`);
await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 20000 });
assert.ok((await page.textContent('#log')).includes(`Rusty left ${await page.evaluate(() => window.left)} for sale.`), 'the log does not say Rusty passed on a lot');
await scene(`const i = B.OWNABLE.find(j => B.SPACES[j].type === 'lot' && s.level[j] === 0 && s.owner[j] !== 0 && (s.owner[j] = 0, G.buyoutPrice(s, j) != null));
  const price = G.buyoutPrice(s, i);
  s.players[1].pos = i; s.players[1].cash = price;
  s.turn = 1; s.dice = [1, 2]; s.phase = 'decide';
  s.pending = { kind: 'rent', at: i, owner: 0, rent: G.rentFor(s, i), buyout: price };`);
await page.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 20000 });
assert.ok((await page.textContent('#log')).includes('Rusty paid the rent rather than make you sell.'), 'the log does not say Rusty could have forced a sale');
assert.match(await page.textContent('#actions .since'), /^Since your turn: Rusty paid you \$[\d,]+\./);
assert.doesNotMatch(await page.textContent('#actions .since'), /rather|for sale/, 'what the townsfolk passed up is in what happened since your turn');

// A lot bought gives its space a bounce, lifted over its neighbours and the frame on paper, so its lines don't sit
// beside theirs; then it goes back in its place, in order for the keyboard.
await scene(`const i = 18;
  s.owner[i] = -1; s.level[i] = 0; s.players[0].cash = 2000; s.players[0].pos = i; s.dice = [1, 2]; s.phase = 'decide';
  s.pending = { kind: 'buy', at: i, price: G.landValue(s, i) };`);
await page.waitForSelector('#sheet [data-c="buy"]');
await page.click('#sheet [data-c="buy"]');
await page.waitForSelector('#board .cell.pop');
assert.deepEqual(await page.$eval('#board .cell.pop', g => [g.dataset.i, !!(document.querySelector('#board .frame').compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING), getComputedStyle(g.querySelector('.bg')).fill.startsWith('url(')]),
  ['18', true, true], 'the space bouncing is drawn under the frame or its neighbours, or without paper');
await page.waitForFunction(() => !document.querySelector('#board .cell.pop'));
assert.equal(await page.$$eval('#board .cells > .cell', cs => cs.length === 28 && cs.every((c, k) => +c.dataset.i === k)), true, 'the spaces are out of order after a bounce');
if (await sheetOpen()) await answer();

// On a desktop, 1280 x 800: the title fits, and the board is square, whole on screen, with the players beside it.
// Here the browser won't let the page keep anything (a private window, a sandboxed frame): a game left from the menu
// can still be carried on, since it is still in memory.
{
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await desk.newPage();
  dp.on('pageerror', e => problems.push(e.message));
  await dp.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }));
  await dp.goto(base);
  await dp.evaluate(() => document.fonts.ready);
  // Records doesn't promise to keep what this browser won't.
  await dp.click('#recordsBtn');
  assert.equal(await dp.textContent('#sheet .note'), "Not kept here: this browser isn't saving anything.", 'Records says it keeps them with no storage');
  await dp.click('#sheet [data-close]');
  const card = await dp.$eval('.title-card', el => el.getBoundingClientRect().toJSON());
  assert.ok(card.width <= 480 && card.left > 300, 'the title card is not centred on a desktop');
  assert.equal(await dp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the title scrolls sideways on a desktop');
  await dp.click('#startBtn');
  await dp.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
  const board = await dp.$eval('.board-wrap', el => el.getBoundingClientRect().toJSON());
  const side = await dp.$eval('.side', el => el.getBoundingClientRect().toJSON());
  assert.ok(Math.abs(board.width - board.height) < 2, 'the board is not square on a desktop');
  assert.ok(board.bottom <= 800 && board.top >= 0, 'the board does not fit a 1280 x 800 screen');
  assert.ok(side.left >= board.right && side.top < board.top + 40, 'the players are not beside the board on a desktop');
  assert.equal(new Set(await dp.$$eval('.chip', cs => cs.map(c => Math.round(c.getBoundingClientRect().left)))).size, 1, 'the players are not in one column');
  assert.equal(await dp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the game scrolls sideways on a desktop');
  const round = await dp.textContent('#round');
  await dp.click('#menuBtn');
  await dp.click('#sheet [data-a="leave"]');
  assert.equal(await dp.isVisible('#resumeBtn'), true, 'Carry on is not offered after leaving, with no storage');
  await dp.click('#resumeBtn');
  await dp.waitForSelector('#actions button:has-text("Roll the dice")');
  assert.equal(await dp.textContent('#round'), round, 'carrying on did not go back to the same game');
  await desk.close();
}

// A tablet held upright, 768 x 1024: the board goes as wide as the screen allows, not a phone's 640, and the players
// still fit below it.
{
  const tab = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true, serviceWorkers: 'block' });
  const tp = await tab.newPage();
  tp.on('pageerror', e => problems.push(e.message));
  await tp.goto(base);
  await tp.click('#startBtn');
  await tp.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 30000 });
  const board = await tp.$eval('.board-wrap', el => el.getBoundingClientRect().toJSON());
  const chips = await tp.$$eval('.chip', cs => Math.max(...cs.map(c => c.getBoundingClientRect().bottom)));
  assert.ok(board.width >= 740, `the board is only ${Math.round(board.width)} px wide on an upright tablet`);
  assert.ok(chips <= 1024, 'the players fall off the bottom of an upright tablet');
  assert.equal(await tp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the game scrolls sideways on an upright tablet');
  await tab.close();
}

// At a shared table nobody is called You: a person left with that name goes by their seat, on the title and in play.
{
  const pp = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p1 = await pp.newPage();
  p1.on('pageerror', e => problems.push(e.message));
  await p1.addInitScript(() => localStorage.setItem('boomtown.prefs', JSON.stringify({ speed: 'fast', sound: false, len: 'short', seats: [{ who: 'you', name: 'You' }, { who: 'you', name: 'Player 2' }, { who: 'none' }, { who: 'none' }] })));
  await p1.goto(base);
  assert.equal(await p1.inputValue('#seats input >> nth=0'), '', 'the title still names the first person You');
  await p1.click('#startBtn');
  await p1.waitForSelector('#actions button:has-text("Roll the dice")');
  assert.equal(await p1.textContent('.chip .nm >> nth=0'), 'Player 1', 'a person at a shared table is called You');
  await pp.close();
}

// Pass and play: two people take turns on one phone, each told when it's their go, through the real buttons.
{
  const pp = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p2 = await pp.newPage();
  p2.on('pageerror', e => problems.push(e.message));
  await p2.addInitScript(() => localStorage.setItem('boomtown.prefs', JSON.stringify({ speed: 'fast', sound: false, len: 'short', seats: [{ who: 'you', name: 'Ann' }, { who: 'you', name: 'Ben' }, { who: 'none' }, { who: 'none' }] })));
  await p2.goto(base);
  await p2.click('#startBtn');
  const names = ['Ann', 'Ben'];
  for (let turn = 0; turn < 6; turn++) {
    const who = names[turn % 2];
    await p2.waitForSelector('#actions button:has-text("Roll the dice")', { timeout: 20000 });
    assert.equal(await p2.evaluate(() => window.boomtown.state.turn), turn % 2, `turn ${turn} is not ${who}'s`);
    if (turn) assert.match(await p2.textContent('#say'), new RegExp(`^${who}, your turn\\.`), `${who} is not told it's their turn`);
    await p2.click('#actions button:has-text("Roll the dice")');
    await p2.waitForSelector('.move-btn');
    assert.match(await p2.textContent('#say'), new RegExp(`^${who}: move by both dice`), `the move line doesn't name ${who}`);
    await p2.click('.move-btn >> nth=0');
    for (let k = 0; k < 40 && !(await p2.$('#actions button:has-text("End turn")')); k++) {
      // The sheet's answer first: the Decide button behind it is covered while the sheet is open.
      const b = (await p2.$eval('#sheetWrap', el => !el.hidden)
        ? await p2.$('#sheet [data-ok], #sheet [data-c="buy"]:not([disabled]), #sheet [data-c="pay"], #sheet .pick:not([disabled]), #sheet [data-c="pass"]')
        : await p2.$('#actions button:has-text("Decide")'));
      if (b) await b.click({ timeout: 3000 }).catch(() => {});
      await p2.waitForTimeout(150);
    }
    await p2.click('#actions button:has-text("End turn")');
  }
  assert.equal(await p2.textContent('#round'), 'Round 4 of 18', 'six turns between two people are not three rounds');
  // Passing the phone, the others weren't looking: a person who leaves a lot for sale is said to, as the townsfolk are.
  await p2.evaluate(async () => {
    const s = window.boomtown.state, G = window.boomtown.G, B = await import('./js/board.js');
    const i = Object.keys(s.owner).map(Number).find(j => s.owner[j] < 0);
    s.players[0].pos = i; s.dice = [1, 2]; s.phase = 'decide';
    s.pending = { kind: 'buy', at: i, price: G.landValue(s, i) };
    window.left = B.SPACES[i].name;
    window.boomtown.start(s, true);
  });
  await p2.click('#sheet [data-c="pass"]');
  await p2.waitForFunction(() => window.boomtown.state.phase === 'manage' && !window.boomtown.busy);
  assert.equal(await p2.textContent('#say'), `Ann left ${await p2.evaluate(() => window.left)} for sale.`, 'a person passing on a lot goes unsaid at a shared table');
  await pp.close();
}

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
// The icons: iOS shows icon-180.png whole (it only rounds the corners), so the board fills it; Android keeps only the
// middle circle, 80% across, of icon-512-maskable.png, so the board stays inside that.
{
  const UPNG = require('upng-js');
  const art = async f => {
    const img = UPNG.decode(await readFile(join(root, f))), px = new Uint8Array(UPNG.toRGBA8(img)[0]), w = img.width, pts = [];
    for (let y = 0; y < img.height; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (Math.abs(px[k] - 0x21) + Math.abs(px[k + 1] - 0x40) + Math.abs(px[k + 2] - 0x2f) > 60) pts.push([x, y]); // not the felt
    }
    return { w, pts };
  };
  const ios = await art('icon-180.png');
  const span = Math.max(...ios.pts.map(p => p[0])) - Math.min(...ios.pts.map(p => p[0])) + 1;
  assert.ok(span / ios.w >= 0.7, `the board fills only ${Math.round(span / ios.w * 100)}% of the iOS icon`);
  const mask = await art('icon-512-maskable.png');
  const out = mask.pts.filter(([x, y]) => Math.hypot(x + 0.5 - mask.w / 2, y + 0.5 - mask.w / 2) > mask.w * 0.4);
  assert.equal(out.length, 0, `${out.length} pixels of the maskable icon's board fall outside Android's circle`);
}
console.log('all good');

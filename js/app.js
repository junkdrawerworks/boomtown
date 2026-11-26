// Boomtown: the screens and the flow of a game. The rules live in game.js, the townsfolk in bots.js and the board
// drawing in view.js; this file asks the players what they want and shows what happened.

import { SPACES, DISTRICT, DISTRICTS, LOTS_IN, OWNABLE, DEPOTS, SPACE_HELP } from './board.js';
import * as G from './game.js';
import { CARD } from './cards.js';
import { BOTS, botStep } from './bots.js';
import { createBoard, calm } from './view.js';
import * as art from './art.js';
import { sfx, setSound, soundOn } from './sound.js';
import * as W from './words.js';

const $ = id => document.getElementById(id);
const KEY = 'boomtown.game', PREFS = 'boomtown.prefs', RECORDS = 'boomtown.records';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* as above */ } },
};

const WHO = [
  { id: 'you', label: 'A person' },
  ...Object.entries(BOTS).map(([id, b]) => ({ id, label: b.name })),
  { id: 'none', label: 'Nobody' },
];
const DEFAULT_SEATS = [{ who: 'you', name: 'You' }, { who: 'rusty' }, { who: 'mabel' }, { who: 'dot' }];

let prefs = { sound: true, speed: 'normal', len: 'standard', seats: DEFAULT_SEATS, ...store.get(PREFS, {}) };
setSound(prefs.sound);
let s = null;                  // the game in play
let gen = 0;                   // bumps when a game is left, so a bot turn in flight stops
let busy = false;              // something is animating; the buttons wait
let note = '';                 // the line in the middle of the board
let ringed = null;             // the space a sheet is about, ringed on the board while the sheet is open
let unused = null;             // after a detour, which die (0 or 1) wasn't moved by: it's dimmed until the next roll
let said = null;               // what the line in the middle last said (see setSay)
let returnTo = null;           // where the focus was when a sheet opened, to go back to when it closes
const view = createBoard($('board'), { onCell: i => showSpace(i) });

const wait = ms => new Promise(r => setTimeout(r, ms));
const pace = () => (prefs.speed === 'fast' ? 0.35 : 1);
const { money, esc } = W;
const nm = p => esc(s.players[p].name);
// A player in a sentence, by seat: 'you' or 'Rusty' in the middle of one, 'You' or 'Rusty' at the start, and 'your' or
// "Rusty's". Only the person playing the townsfolk alone is called You (see words.js).
const who = p => esc(W.who(s.players[p]));
const Who = p => esc(W.Who(s.players[p]));
const whose = p => esc(W.whose(s.players[p]));
const Whose = p => esc(W.Whose(s.players[p]));
const agree = (p, you, they) => W.agree(s.players[p], you, they);
const colorOf = p => art.PLAYER_COLORS[s.players[p].token];
const save = () => { if (s) store.set(KEY, s); };
const humans = () => s.players.filter(p => p.kind === 'human').length;
const isHumanTurn = () => s && s.phase !== 'over' && G.current(s).kind === 'human';
const { swatch } = W;
const ring = i => { ringed = i; if (s) view.focus(i); };
// A space in a sentence: 'the Land Office', 'Ferry Landing'.
const place = i => (['office', 'yard', 'tax'].includes(SPACES[i].type) ? 'the ' : '') + esc(SPACES[i].name);

// The line in the middle of the board is read out as it changes (aria-live), so it's written only when it does: the
// same words written again would be read again.
function setSay(html) {
  if (html === said) return;
  said = html;
  $('say').innerHTML = html;
}

// Keyboard and screen-reader players: the button the turn waits on (Roll the dice, the first move, End turn, Decide)
// takes the focus when the buttons are redrawn, so the next press is always the next step.
const adrift = el => !el || el === document.body || !el.isConnected || !!el.closest('[hidden]');
function focusMain() {
  const b = $('actions').querySelector('[data-main]');
  b?.focus({ preventScroll: true });
  return !!b;
}

// ---------- the title screen ----------
// `focus`: put the focus on Carry on, or Break ground. Not as the page opens, where it would draw the keyboard's ring on
// a phone before anyone has touched it.
function showTitle(focus = true) {
  gen++;
  closeSheet();
  $('app').hidden = true;
  $('title').hidden = false;
  const game = unfinished();
  $('resumeBtn').hidden = !game;
  $('resumeWhat').textContent = game ? savedLine(game) : '';
  drawSeats();
  drawLengths();
  document.title = 'Boomtown';
  if (focus) (game ? $('resumeBtn') : $('startBtn')).focus({ preventScroll: true });
}

function drawSeats() {
  const el = $('seats');
  el.innerHTML = '';
  const people = prefs.seats.filter(x => x.who === 'you').length;
  prefs.seats.forEach((seat, k) => {
    const row = document.createElement('div');
    row.className = 'seat' + (seat.who === 'none' ? ' off' : '');
    const taken = prefs.seats.filter((x, j) => j !== k).map(x => x.who);
    row.innerHTML = `${art.tokenSvg(k, 30)}
      <select aria-label="Seat ${k + 1}, the ${art.TOKEN_NAMES[k]}">${WHO.map(w =>
        `<option value="${w.id}"${w.id === seat.who ? ' selected' : ''}${BOTS[w.id] && taken.includes(w.id) ? ' disabled' : ''}>${w.label}</option>`).join('')}</select>
      ${seat.who === 'you'
        ? `<input aria-label="Name for seat ${k + 1}" maxlength="14" autocomplete="off" placeholder="Player ${k + 1}" value="${people > 1 && seat.name === 'You' ? '' : esc(seat.name || '')}">`
        : `<span class="line">${BOTS[seat.who] ? BOTS[seat.who].line : 'This seat is empty.'}</span>`}`;
    const sel = row.querySelector('select'), inp = row.querySelector('input');
    sel.addEventListener('change', () => {
      seat.who = sel.value;
      if (seat.who === 'you' && !seat.name) seat.name = prefs.seats.some((x, j) => j !== k && x.who === 'you') ? `Player ${k + 1}` : 'You';
      store.set(PREFS, prefs);
      drawSeats(); drawLengths();
    });
    inp?.addEventListener('input', () => { seat.name = inp.value.trim(); store.set(PREFS, prefs); });
    el.appendChild(row);
  });
}

function drawLengths() {
  const n = Math.max(2, prefs.seats.filter(x => x.who !== 'none').length);
  for (const len of Object.keys(G.ROUNDS)) {
    $('len-' + len).textContent = `${G.ROUNDS[len][n]} rounds`;
    document.querySelector(`[data-len="${len}"]`).setAttribute('aria-pressed', String(prefs.len === len));
  }
  const ok = prefs.seats.filter(x => x.who !== 'none').length >= 2;
  $('startBtn').disabled = !ok;
  $('startBtn').textContent = ok ? 'Break ground' : 'Pick at least two players';
}

$('lengths').addEventListener('click', e => {
  const b = e.target.closest('button[data-len]');
  if (!b) return;
  prefs.len = b.dataset.len;
  store.set(PREFS, prefs);
  drawLengths();
});

// Break ground with a game unfinished asks first: starting saves over it.
$('startBtn').addEventListener('click', () => {
  const game = unfinished();
  if (!game) { breakGround(); return; }
  const body = openSheet(`<h2 id="sheetTitle">Start a new game?</h2>
    <p>Your game in round ${game.round} of ${game.rounds} will be lost.</p>
    <div class="buttons"><button class="primary" data-a="new">Start the new game</button><button class="secondary" data-a="keep">Keep that game</button></div>`);
  body.querySelector('[data-a="new"]').addEventListener('click', breakGround);
  body.querySelector('[data-a="keep"]').addEventListener('click', () => closeSheet());
  body.querySelector('[data-a="keep"]').focus(); // Enter or Space on the question keeps the game
});
function breakGround() {
  const seats = prefs.seats.map((x, k) => ({ ...x, token: k })).filter(x => x.who !== 'none').map(x => {
    if (x.who === 'you') return { name: x.name || `Player ${x.token + 1}`, kind: 'human', token: x.token };
    return { name: BOTS[x.who].name, kind: 'bot', bot: x.who, token: x.token };
  });
  // With more than one person at the table, the game can't talk to one of them as You: a person still called You
  // goes by their seat instead, 'Player 1'.
  if (seats.filter(x => x.kind === 'human').length > 1) for (const x of seats) if (x.kind === 'human' && x.name === 'You') x.name = `Player ${x.token + 1}`;
  // Two people with the same name would be confusing: number them.
  const seen = {};
  for (const x of seats) { seen[x.name] = (seen[x.name] || 0) + 1; if (seen[x.name] > 1) x.name += ` ${seen[x.name]}`; }
  startGame(G.newGame({ seats, rounds: G.ROUNDS[prefs.len][seats.length] }));
}

// The game to carry on: the saved one, or, where the browser won't let the page keep anything (a private window, a
// sandboxed frame), the one left from the menu, which is still in memory.
function unfinished() {
  const saved = store.get(KEY, null);
  if (saved && saved.v === 1 && saved.phase !== 'over') return saved;
  return s && s.phase !== 'over' ? s : null;
}
// What Carry on carries on: 'Round 4 of 20, with Rusty, Mabel and Dot'.
function savedLine(game) {
  const and = l => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0] || '');
  const solo = game.players.filter(p => p.kind === 'human').length === 1 && game.players.some(p => p.name === 'You');
  const names = game.players.map(p => p.name).filter(n => !solo || n !== 'You');
  return `Round ${game.round} of ${game.rounds}, ${solo ? 'with ' : ''}${and(names)}`;
}
$('resumeBtn').addEventListener('click', () => {
  const game = unfinished();
  if (game) startGame(game, true);
});
$('rulesBtn').addEventListener('click', showRules);
$('recordsBtn').addEventListener('click', showRecords);

function startGame(game, resumed = false) {
  s = game;
  s.log ||= [];
  gen++;
  closeSheet(); // Play again starts from Founders' Day's sheet
  unused = null;
  $('title').hidden = true;
  $('app').hidden = false;
  view.reset();
  note = resumed ? `Back in Boomtown. ${whoseTurn()}` : 'Ground broken. Every lot is for sale.';
  if (!resumed) { addLog(`A new game: ${s.rounds} rounds, ${s.players.length} players.`); addLog(`Round ${s.round}`); save(); }
  render();
  run();
}

// ---------- drawing the play screen ----------
function whoseTurn() {
  const pl = G.current(s);
  // The first turn of the last round says what's coming.
  const last = s.round === s.rounds && s.turn === 0 && s.phase === 'roll' ? " Founders' Day after this round." : '';
  if (pl.kind === 'bot') return `${esc(pl.name)}'s turn.${last}`;
  return (humans() > 1 || pl.name !== 'You' ? `${esc(pl.name)}, your turn.` : 'Your turn.') + last;
}

function render() {
  if (!s) return;
  const human = isHumanTurn() && !busy;
  const p = s.turn, pl = G.current(s);
  const last = s.phase !== 'over' && s.round === s.rounds;
  $('round').textContent = s.phase === 'over' ? "Founders' Day" : last ? 'Last round' : `Round ${s.round} of ${s.rounds}`;
  $('round').classList.toggle('last', last);
  // Board marks: where the dice can take you, what you can build on.
  let dests = [], buildable = [];
  if (human && s.phase === 'move') dests = G.moveOptions(s).map(o => ({ to: o.to, label: o.steps, usable: o.usable }));
  if (human && s.phase === 'manage') buildable = OWNABLE.filter(i => G.canBuild(s, p, i).ok);
  view.render(s, { dests, buildable, focus: ringed });
  drawPlayers();
  drawLogList();
  drawDice();
  setSay(note);
  // The buttons in the middle. Emptying them drops the focus if it was on one, so it's put back on the new main button,
  // unless the person is somewhere else (a space on the board, a sheet).
  const a = $('actions');
  const was = document.activeElement, refocus = adrift(was) || a.contains(was);
  a.innerHTML = '';
  if (!human) return;
  if (s.phase === 'roll') {
    const since = sinceLine(p);
    if (since) { const el = document.createElement('p'); el.className = 'since'; el.innerHTML = since; a.append(el); }
    a.append(btn('Roll the dice', 'primary big', onRoll, true));
    if (OWNABLE.some(i => s.owner[i] === p)) a.append(btn('Your lots', 'ghost', () => showLots()));
  } else if (s.phase === 'move') {
    for (const o of G.moveOptions(s)) {
      const b = btn('', (o.detour ? 'secondary' : 'primary') + ' move-btn', () => onMove(o), o.usable && !a.querySelector('[data-main]'));
      b.disabled = !o.usable;
      b.innerHTML = `<span class="n">${o.steps}</span><span class="what"><b>${o.detour ? 'Detour, one die' : 'Both dice'}</b>${preview(o)}</span>`;
      a.append(b);
    }
    const d = document.createElement('div');
    d.className = 'detours';
    d.textContent = pl.detours ? `Detours left: ${'◆'.repeat(pl.detours)} (one back each Payday)` : 'No detours left until Payday.';
    a.append(d);
  } else if (s.phase === 'manage') {
    const n = OWNABLE.filter(i => G.canBuild(s, p, i).ok).length;
    const row = document.createElement('div');
    row.className = 'row';
    if (OWNABLE.some(i => s.owner[i] === p)) row.append(btn(n ? `Build (${n})` : 'Your lots', 'secondary', () => showLots()));
    row.append(btn('End turn', 'primary', onEndTurn, true));
    a.append(row);
  } else if (s.phase === 'decide') {
    a.append(btn('Decide', 'primary', () => askDecision(), true));
  }
  if (refocus && $('sheetWrap').hidden) focusMain();
}

function btn(text, cls, fn, main = false) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  if (main) b.dataset.main = '';
  b.addEventListener('click', () => { if (!busy) fn(); });
  return b;
}

// Would this move get the Lumberyard's question? Only with something of yours that can go up at half price, with the
// cash you'll have there (Payday on the way counts): so make the move on a copy of the game and see.
function yardAsks(o) {
  try {
    const t = JSON.parse(JSON.stringify({ ...s, log: [], since: null }));
    G.move(t, o.steps, o.detour);
    return t.pending?.kind === 'yard';
  } catch { return true; } // a detour with none left: it can't be taken anyway
}

// What a move would land on, in a few words.
function preview(o) {
  const p = s.turn, sp = SPACES[o.to], pl = G.current(s);
  const parts = [];
  const passes = pl.pos + o.steps >= SPACES.length;
  switch (sp.type) {
    case 'lot': case 'depot': {
      const w = s.owner[o.to];
      if (w < 0) parts.push(`${esc(sp.name)}, for sale ${money(G.landValue(s, o.to))}`);
      else if (w === p) parts.push(`${esc(sp.name)}, yours`);
      else parts.push(`${esc(sp.name)}: rent ${money(G.rentFor(s, o.to))} to ${nm(w)}`);
      break;
    }
    case 'payday': parts.push(`Payday, ${money(G.RULES.salary + G.RULES.landBonus)}`); break;
    case 'gazette': parts.push('The Gazette'); break;
    case 'office': parts.push(G.emptyLots(s).length ? 'Land Office: buy any empty lot' : 'Land Office: nothing left for sale'); break;
    case 'yard': parts.push(yardAsks(o) ? 'Lumberyard: build at half price' : 'Lumberyard: nothing to build at half price'); break;
    case 'square': parts.push(`Town Square: kitty ${money(s.kitty)}`); break;
    case 'hall': parts.push('City Hall: rezone a district'); break;
    case 'tax': parts.push(`Assessor: pay ${money(Math.max(G.RULES.taxMin, G.holdings(s, p).levels * G.RULES.taxPerLevel))}`); break;
  }
  if (passes && o.to !== 0) parts.push(`+${money(G.RULES.salary)} passing Payday`);
  return parts.join(' · ');
}

function drawDice() {
  const el = $('dice');
  if (!s.dice || s.phase === 'over') { el.innerHTML = ''; return; }
  if (el.dataset.v !== s.dice.join()) {
    el.innerHTML = s.dice.map(v => `<span class="die">${art.dieFace(v)}</span>`).join('');
    el.dataset.v = s.dice.join();
  }
  [...el.children].forEach((d, k) => d.classList.toggle('used', k === unused));
}

function drawPlayers() {
  const el = $('players');
  const html = s.players.map((pl, p) => {
    const worth = G.netWorth(s, p);
    const detours = `${pl.detours} detour${pl.detours === 1 ? '' : 's'}`;
    // Two rows that never change shape: name and cash, then what they're worth, or what they owe while they owe it.
    return `<div class="chip${p === s.turn && s.phase !== 'over' ? ' now' : ''}" aria-label="${esc(pl.name)}: ${money(pl.cash)} cash${pl.debt ? `, owes ${money(pl.debt)}` : ''}, worth ${money(worth)}, ${detours}">
      <span class="tk">${art.tokenSvg(pl.token, 30)}</span>
      <span class="r"><span class="nm">${esc(pl.name)}</span><span class="cash">${money(pl.cash)}</span></span>
      <span class="r">${pl.debt ? `<span class="sub debt">owes ${money(pl.debt)}</span>` : `<span class="sub worth">worth ${money(worth)}</span>`}<span class="dt" title="${detours}" aria-hidden="true">${'◆'.repeat(pl.detours)}</span></span>
    </div>`;
  });
  // Redraw only the cards that changed, so a card lighting up (see flashCard) isn't cut short by the next render.
  if (el.children.length !== html.length) el.innerHTML = html.join('');
  else html.forEach((h, p) => { if (el.children[p]._h !== h) el.children[p].outerHTML = h; });
  [...el.children].forEach((c, p) => { c._h = html[p]; });
}

// A player's card lights up gold for a moment: money came in.
function flashCard(p) {
  const c = $('players').children[p];
  if (!c) return;
  c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
  setTimeout(() => c.classList.remove('flash'), 700);
}

// The log keeps a whole long game (a few hundred lines), with a 'Round 5' line where each round starts.
const LOG_MAX = 1000;
const isRoundLine = t => /^Round \d+$/.test(t);
const logItem = t => (isRoundLine(t) ? `<li class="round">${esc(t)}</li>` : `<li>${esc(t)}</li>`);
function addLog(text) {
  if (!text) return;
  s.log.push(text.replace(/<[^>]+>/g, ''));
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}
// Beside the board on a wide screen: the latest lines, oldest at the top, the newest at the foot (the list runs
// bottom up, so it opens on the newest).
function drawLogList() {
  $('log').innerHTML = s.log.slice(-30).reverse().map(logItem).join('');
}
// The What happened sheet: newest first, from the top, each round's lines under its own heading.
function logSheetHtml() {
  const rounds = [[]];
  for (const t of s.log) { if (isRoundLine(t)) rounds.push([]); rounds[rounds.length - 1].push(t); }
  return rounds.reverse().map(r => {
    const head = isRoundLine(r[0]) ? r.shift() : null;
    return (head ? logItem(head) : '') + r.reverse().map(logItem).join('');
  }).join('');
}

// ---------- the flow of turns ----------
// Let the townsfolk play until it's a person's move, then wait for them.
async function run() {
  const my = gen;
  while (s && s.phase !== 'over' && G.current(s).kind === 'bot') {
    if (s.phase === 'roll') { note = whoseTurn(); render(); }
    await wait((s.phase === 'roll' ? 550 : s.phase === 'manage' ? 380 : 520) * pace());
    if (my !== gen) return;
    // A sheet the person opened (a lot, the menu) holds the townsfolk until it's closed, so what it says stays true.
    // Only one the person can close: the townsfolk never wait on a sheet nobody can shut.
    while (!$('sheetWrap').hidden && $('scrim').onclick) {
      await wait(150);
      if (my !== gen) return;
    }
    const ev = botStep(s);
    save();
    await play(ev, my);
    if (my !== gen) return;
  }
  if (my !== gen || !s) return;
  if (s.phase === 'over') { render(); finish(); return; }
  if (s.phase === 'roll') note = whoseTurn();
  render();
  if (s.phase === 'decide') askDecision();
}

async function onRoll() {
  const my = gen;
  if (s.since) s.since[s.turn] = [];
  const ev = G.roll(s);
  save();
  await play(ev, my);
  note = humans() > 1 ? `${nm(s.turn)}: move by both dice, or take a detour.` : 'Move by both dice, or take a detour by one.';
  render();
}

async function onMove(o) {
  const my = gen;
  const ev = G.move(s, o.steps, o.detour);
  save();
  note = '';
  await play(ev, my);
  if (my !== gen) return;
  if (s.phase === 'decide') { if (!note) note = landedNote(true); render(); askDecision(); return; }
  // A line that says only how you moved (a detour, passing Payday) is followed by where you are.
  const told = ev.some(e => e.t === 'card' || e.t === 'kitty' || e.t === 'pay' || (e.t === 'collect' && e.why !== 'Payday'));
  note = !note ? landedNote() : told ? note : `${note} ${landedNote(true)}`;
  render();
}

// Where you landed, when it asked nothing: and why not, where a space might have.
function landedNote(short = false) {
  const p = s.turn, sp = SPACES[G.current(s).pos];
  if (sp.type === 'office' && !G.emptyLots(s).length) return 'On the Land Office: nothing left for sale.';
  if (sp.type === 'yard' && !OWNABLE.some(i => G.canBuild(s, p, i, 0.5).ok)) return 'On the Lumberyard: nothing of yours can go up at half price.';
  const on = place(G.current(s).pos);
  return short ? `On ${on}.` : `On ${on}. Build if you like, then end your turn.`;
}

async function onEndTurn() {
  const my = gen;
  const ev = G.endTurn(s);
  save();
  await play(ev, my);
  run();
}

async function decideWith(choice) {
  const my = gen;
  closeSheet();
  const ev = G.decide(s, choice);
  save();
  await play(ev, my);
  if (my !== gen) return;
  if (isHumanTurn()) { if (!note) note = landedNote(); render(); }
}

async function doBuild(i) {
  const my = gen;
  const ev = G.build(s, i);
  save();
  await play(ev, my);
  render();
}

async function doSell(i) {
  const my = gen;
  const ev = G.sell(s, i);
  save();
  await play(ev, my);
  render();
}

// Show a list of events: move the pieces, float the money, read the Gazette, and write it all in the log.
async function play(events, my = gen) {
  busy = true;
  render();
  const k = pace(), bot = G.current(s).kind === 'bot';
  let detour = false;
  try {
    for (const e of events) {
      if (my !== gen) return;
      const line = describe(e);
      addLog(line);
      noteSince(e);
      switch (e.t) {
        case 'roll': {
          sfx.dice();
          unused = null;
          drawDice();
          const d = $('dice');
          d.classList.remove('rolling'); void d.offsetWidth; d.classList.add('rolling');
          note = line;
          setSay(note);
          await wait(500 * k);
          break;
        }
        case 'detour': note = line; setSay(note); detour = true; break;
        case 'move': {
          const ms = calm() ? 0 : (bot ? 120 : 140) * k;
          const steps = e.path.length;
          if (detour && s.dice) { unused = s.dice[0] === steps ? 1 : 0; detour = false; drawDice(); } // dim the other die
          if (ms) for (let j = 0; j < steps; j++) setTimeout(() => sfx.hop(), j * ms);
          else sfx.hop();
          await view.animateMove(s, e.p, e.path, ms);
          // Where the townsfolk went, for anyone listening rather than watching.
          if (bot) { note = `${nm(e.p)} to ${place(e.path[steps - 1])}.`; setSay(note); }
          break;
        }
        case 'collect':
          if (e.why === 'selling up') break;
          view.float(s.players[e.p].pos, `+${money(e.amount)}`, '#1f7a46');
          if (e.why.startsWith('Payday')) sfx.payday(); else sfx.coin();
          note = line || note; render();
          await wait(450 * k);
          break;
        case 'pay':
          if (e.to === 'bank') break; // a purchase: the buy or build event shows it
          view.float(s.players[e.from].pos, `−${money(e.amount)}`, '#b23a2a');
          note = line || note; render();
          if (typeof e.to === 'number') {
            // Rent and forced sales: out of one piece and, a beat later, into the other. A person hears the coin when
            // the money comes to them from one of the townsfolk.
            const to = e.to, kind = p => s.players[p].kind;
            if (kind(to) === 'human' && kind(e.from) !== 'human') sfx.coin(); else sfx.pay();
            setTimeout(() => { if (my !== gen) return; view.float(s.players[to].pos, `+${money(e.amount)}`, '#1f7a46'); flashCard(to); }, 250 * k);
          } else sfx.pay();
          await wait(600 * k);
          break;
        case 'loan': note += ` ${line}`; render(); await wait(400 * k); break;
        case 'buy': case 'buyout':
          sfx.stamp(); render(); view.pop(e.at); note = line; setSay(note);
          // A person made to sell gets long enough to read it.
          await wait((e.t === 'buyout' && s.players[e.from].kind === 'human' ? 1200 : 550) * k);
          break;
        case 'build': case 'sell':
          if (e.t === 'build') sfx.build(); else sfx.pay();
          render(); view.pop(e.at); note = line; setSay(note);
          await wait(500 * k);
          break;
        case 'land': render(); break;
        case 'card': {
          sfx.paper();
          render();
          // The townsfolk's news shows as a toast, which is read out itself: the line in the middle doesn't say it again.
          if (bot || !isHumanTurn()) await toastCard(e.card, 2400 * k);
          else { await showCard(e.card); note = `<b>${esc(CARD[e.card].head)}.</b>`; }
          break;
        }
        case 'kitty': note = line; render(); break;
        case 'rezone': sfx.stamp(); note = line; render(); await wait(500 * k); break;
        case 'interest': case 'repaid': render(); break;
        case 'turn': if (e.p === 0) addLog(`Round ${e.round}`); note = whoseTurn(); break;
        case 'over': sfx.end(); break;
      }
    }
  } finally {
    busy = false;
  }
  render();
}

// ---------- since your turn ----------
// While others play, what happens to each person off their turn (a lot they were made to sell, rent paid to them, land
// moving where they own lots) is kept in s.since[p], saved with the game, and told to them in one line above Roll when
// their turn comes round. It goes once they roll.
let lastSince = null; // the entry the event just before made, which a 'repaid' after it adds to
function noteSince(e) {
  const prev = lastSince;
  lastSince = null;
  const off = q => s.players[q]?.kind === 'human' && q !== s.turn;
  const list = q => ((s.since ||= [])[q] ||= []);
  switch (e.t) {
    case 'pay':
      if (typeof e.to !== 'number' || !off(e.to)) break;
      if (e.why.startsWith('rent')) list(e.to).push(lastSince = { t: 'rent', from: e.from, amount: e.amount, loan: 0 });
      else if (e.why.startsWith('buying')) list(e.to).push(lastSince = { t: 'sale', by: e.from, amount: e.amount, loan: 0, at: null });
      break;
    case 'repaid': if (prev && off(e.p)) { prev.loan += e.amount; lastSince = prev; } break;
    case 'buyout': if (off(e.from)) { const x = list(e.from).find(y => y.t === 'sale' && y.at == null); if (x) x.at = e.at; } break;
    case 'land':
      s.players.forEach((_, q) => {
        if (!off(q) || !LOTS_IN[e.d].some(i => s.owner[i] === q)) return;
        const x = list(q).find(y => y.t === 'land' && y.d === e.d);
        if (x) x.to = e.to; else list(q).push({ t: 'land', d: e.d, from: e.from, to: e.to });
      });
      break;
  }
}
function sinceLine(p) {
  const l = s.since?.[p];
  if (!l?.length) return '';
  const loan = x => (x.loan >= x.amount ? ' (it went to your loan)' : x.loan ? ` (${money(x.loan)} of it went to your loan)` : '');
  const parts = l.filter(x => x.t === 'sale' && x.at != null).map(x => `${nm(x.by)} made you sell ${esc(SPACES[x.at].name)} for ${money(x.amount)}${loan(x)}.`);
  const rent = new Map();
  for (const x of l.filter(y => y.t === 'rent')) {
    const r = rent.get(x.from) || { amount: 0, loan: 0 };
    r.amount += x.amount; r.loan += x.loan;
    rent.set(x.from, r);
  }
  for (const [q, r] of rent) parts.push(`${nm(q)} paid you ${money(r.amount)}${loan(r)}.`);
  for (const x of l.filter(y => y.t === 'land' && y.to !== y.from)) {
    const n = LOTS_IN[x.d].filter(i => s.owner[i] === p).length;
    if (n) parts.push(`${DISTRICT[x.d].name} land went ${x.to > x.from ? 'up' : 'down'}, where you own ${n === 1 ? 'a lot' : `${n} lots`}.`);
  }
  if (!parts.length) return '';
  const more = parts.length > 4 ? ` And ${parts.length - 4} more: see what happened.` : '';
  return `<b>Since your turn:</b> ${parts.slice(0, 4).join(' ')}${more}`;
}

let landMoved = null; // the last 'land' event: a sale's line says how far the land fell
function describe(e) {
  if (e.t === 'land') landMoved = e;
  else if (e.t !== 'collect' && e.t !== 'sell') landMoved = null; // a sale's own events are land, collect, sell
  const sp = i => esc(SPACES[i].name);
  switch (e.t) {
    case 'roll': return `${nm(e.p)} rolled ${e.dice[0]} and ${e.dice[1]}.`;
    case 'detour': return `${nm(e.p)} took a detour (${e.left} left).`;
    case 'collect':
      if (e.why === 'Payday') return `${nm(e.p)} collected ${money(e.amount)} passing Payday.`;
      if (e.why.startsWith('Payday')) return `${nm(e.p)} landed on Payday: ${money(e.amount)}.`;
      if (e.why === 'the county fair') return `${nm(e.p)} collected ${money(e.amount)} at the fair.`;
      if (e.why === 'an inheritance') return `${nm(e.p)} inherited ${money(e.amount)}.`;
      return null;
    case 'pay':
      if (typeof e.to === 'number') return e.why.startsWith('rent') ? `${nm(e.from)} paid ${who(e.to)} ${money(e.amount)} ${esc(e.why)}.` : null;
      if (e.to === 'kitty') return `${nm(e.from)} paid ${money(e.amount)} for ${esc(e.why)}, into the kitty.`;
      return null;
    case 'loan': return `The bank lent ${who(e.p)} ${money(e.amount)}.`;
    case 'repaid': return `${money(e.amount)} went to paying off ${whose(e.p)} loan.`;
    case 'interest': return `${money(e.amount)} interest went on ${whose(e.p)} loan.`;
    case 'buy': return `${nm(e.p)} bought ${sp(e.at)} for ${money(e.price)}.`;
    case 'buyout': return `${nm(e.p)} made ${who(e.from)} sell ${sp(e.at)}, for ${money(e.price)}.`;
    case 'build': return `${nm(e.p)} built a ${G.LEVEL_NAMES[e.level].toLowerCase()} on ${sp(e.at)}.`;
    case 'sell': {
      const d = SPACES[e.at].district, fell = landMoved?.d === d ? Math.round((landMoved.from - landMoved.to) * 100) : 0;
      landMoved = null;
      return `${nm(e.p)} sold the ${G.LEVEL_NAMES[e.level + 1].toLowerCase()} on ${sp(e.at)} back for ${money(e.refund)}.${fell > 0 ? ` ${DISTRICT[d].name} land fell ${fell}%.` : ''}`;
    }
    case 'card': return `The Gazette: ${esc(CARD[e.card].head)}.`;
    case 'kitty': return `${nm(e.p)} took the kitty: ${money(e.amount)}.`;
    case 'rezone': return `${nm(e.p)} rezoned ${DISTRICT[e.d].name}: land up 20%.`;
    case 'over': return "Founders' Day. The game is over.";
  }
  return null;
}

// ---------- sheets ----------
let onSheetClose = null;
// While a sheet is open, everything behind it is inert: no tap, Tab or screen reader reaches it. The focus goes to the
// sheet's first answer, or to its heading when there is nothing to answer, and back where it was when it closes.
function openSheet(html, { light = false, closable = true, onClose = null } = {}) {
  if ($('sheetWrap').hidden) returnTo = document.activeElement;
  $('sheetBody').innerHTML = (closable ? '<button class="close" data-close aria-label="Close">✕</button>' : '') + html;
  $('sheetWrap').hidden = false;
  $('app').inert = $('title').inert = true;
  $('sheetWrap').classList.toggle('light', light);
  onSheetClose = closable ? onClose : null;
  $('scrim').onclick = closable ? () => closeSheet(true) : null;
  $('sheet').scrollTop = 0;
  const first = $('sheet').querySelector('.buttons button:not(:disabled), .pick:not(:disabled), button:not(.close):not(:disabled)');
  const head = $('sheetTitle');
  if (!first && head) head.tabIndex = -1;
  (first || head || $('sheet')).focus({ preventScroll: true });
  return $('sheetBody');
}
function closeSheet(byUser = false) {
  const was = !$('sheetWrap').hidden;
  $('sheetWrap').hidden = true;
  $('app').inert = $('title').inert = false;
  const f = onSheetClose;
  onSheetClose = null;
  if (ringed != null) ring(null);
  if (was) {
    const back = returnTo;
    returnTo = null;
    if (!adrift(back) && back.getClientRects().length) back.focus({ preventScroll: true });
    else focusMain();
  }
  if (was && byUser && f) f();
}
$('sheetBody').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(true); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sheetWrap').hidden && $('scrim').onclick) closeSheet(true); });
// Tab and Shift+Tab go round the open sheet's buttons and links, never out of it.
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || $('sheetWrap').hidden) return;
  const all = [...$('sheet').querySelectorAll('button, a[href], input, select, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
  e.preventDefault();
  if (!all.length) return;
  const at = document.activeElement, k = all.indexOf(at);
  let next;
  if (k >= 0) next = all[(k + (e.shiftKey ? -1 : 1) + all.length) % all.length];
  else { // on the sheet or its heading: the next one along from there
    const after = all.filter(el => at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    next = e.shiftKey ? all.filter(el => !after.includes(el)).pop() || all[all.length - 1] : after[0] || all[0];
  }
  next.focus();
});

const lotFacts = (i, o) => W.lotFacts(s, i, o);

function showSpace(i) {
  // While the townsfolk play, a space can be looked at any time (its sheet then has no buttons, and holds them up).
  if (!s || (busy && isHumanTurn())) return;
  const sp = SPACES[i], p = s.turn, mine = s.owner[i] === p && isHumanTurn();
  let h;
  if (sp.type === 'lot' || sp.type === 'depot') {
    h = lotFacts(i, { warn: true });
    if (mine && sp.type === 'lot') {
      const c = G.canBuild(s, p, i);
      const b = [];
      if (s.phase === 'manage' && s.level[i] < G.RULES.maxLevel) {
        b.push(`<button class="primary" data-build ${c.ok ? '' : 'disabled'}>Build a ${G.LEVEL_NAMES[s.level[i] + 1].toLowerCase()}: ${money(G.buildCost(i))}</button>`);
        if (!c.ok && c.reason) b.push(`<p class="note">${esc(c.reason)}</p>`);
      }
      if (G.canSell(s, p, i) && (s.phase === 'manage' || s.phase === 'roll')) b.push(`<button class="secondary" data-sell>Sell the ${G.LEVEL_NAMES[s.level[i]].toLowerCase()} back for ${money(G.sellValue(i))}</button>`);
      if (b.length) h += `<div class="buttons stick">${b.join('')}</div>`;
    }
  } else {
    h = `<h2 id="sheetTitle">${esc(sp.name)}</h2><p>${SPACE_HELP[sp.type]}</p>`;
    if (sp.type === 'square') h += `<p>The kitty holds <b>${money(s.kitty)}</b>.</p>`;
    if (sp.type === 'payday') h += `<p>Pay is ${money(G.RULES.salary)}, or ${money(G.RULES.salary + G.RULES.landBonus)} for landing on it. Passing it also gives back a detour, and adds interest to any loan.</p>`;
  }
  const body = openSheet(h, { light: true });
  ring(i);
  body.querySelector('[data-build]')?.addEventListener('click', () => { closeSheet(); doBuild(i); });
  body.querySelector('[data-sell]')?.addEventListener('click', () => { closeSheet(); doSell(i); });
}

// The current player's lots, with build and sell buttons.
function showLots() {
  const p = s.turn;
  const mine = OWNABLE.filter(i => s.owner[i] === p);
  const canAct = isHumanTurn();
  let h = `<h2 id="sheetTitle">${Whose(p)} lots</h2>`;
  h += s.phase === 'manage' ? '<p class="note">Build as much as you can afford. A block needs the whole district.</p>' : '<p class="note">You can build after you move. Selling a building back gets half of what it cost.</p>';
  h += '<div class="pick-list">';
  for (const i of mine) {
    const sp = SPACES[i];
    if (sp.type === 'depot') {
      const price = G.buyoutPrice(s, i);
      h += `<div class="pick" style="cursor:default"><span class="swatch" style="background:#7d6b5a"></span><span>${esc(sp.name)}<small>Rent ${money(G.rentFor(s, i))}</small>${price != null ? `<small class="warn">A rival can make you sell for ${money(price)}</small>` : ''}</span><span></span></div>`;
      continue;
    }
    const c = G.canBuild(s, p, i);
    const lv = s.level[i];
    const next = lv < G.RULES.maxLevel ? `${G.LEVEL_NAMES[lv + 1]}: rent ${money(G.rentFor(s, i, lv + 1))}` : 'Built as tall as it goes';
    h += `<div class="pick" style="grid-template-columns: 14px 1fr auto auto; cursor:default">${swatch(sp.district)}
      <span>${esc(sp.name)}<small>${G.LEVEL_NAMES[lv]}, rent ${money(G.rentFor(s, i))} · ${s.phase === 'manage' && !c.ok && c.reason && lv < G.RULES.maxLevel ? esc(c.reason) : next}</small>${G.buyoutPrice(s, i) != null ? `<small class="warn">Empty: a rival can make you sell for ${money(G.buyoutPrice(s, i))}</small>` : ''}</span>
      ${canAct && G.canSell(s, p, i) ? `<button class="secondary sell" data-sell="${i}" aria-label="Sell the ${G.LEVEL_NAMES[lv].toLowerCase()} on ${esc(sp.name)} back for ${money(G.sellValue(i))}">Sell ${money(G.sellValue(i))}</button>` : '<span></span>'}
      ${canAct && s.phase === 'manage' && lv < G.RULES.maxLevel ? `<button class="primary" data-build="${i}" ${c.ok ? '' : 'disabled'} aria-label="Build on ${esc(sp.name)} for ${money(G.buildCost(i))}" style="padding:6px 9px">+${money(G.buildCost(i))}</button>` : '<span></span>'}
    </div>`;
  }
  if (!mine.length) h += '<p>No lots yet.</p>';
  h += `</div><p class="note">Cash: <b>${money(s.players[p].cash)}</b>${s.players[p].debt ? ` · owes the bank ${money(s.players[p].debt)}` : ''}</p>`;
  const body = openSheet(h);
  body.querySelectorAll('[data-build]').forEach(b => b.addEventListener('click', async () => { closeSheet(); await doBuild(+b.dataset.build); showLots(); }));
  // Selling asks twice: the first tap turns the button into "Sure? +$25" for a few seconds, and only a second tap sells.
  body.querySelectorAll('[data-sell]').forEach(b => {
    const i = +b.dataset.sell, label = [b.textContent, b.getAttribute('aria-label')];
    let timer = null;
    b.addEventListener('click', async () => {
      if (busy) return;
      if (!timer) {
        b.classList.add('sure');
        b.textContent = `Sure? +${money(G.sellValue(i))}`;
        b.setAttribute('aria-label', `Sure? Tap again to ${label[1].toLowerCase()}`);
        timer = setTimeout(() => { timer = null; b.classList.remove('sure'); [b.textContent] = label; b.setAttribute('aria-label', label[1]); }, 3000);
        return;
      }
      clearTimeout(timer);
      closeSheet(); await doSell(i); showLots();
    });
  });
}

// Ask the person whose turn it is to answer the game's question.
function askDecision() {
  if (!isHumanTurn() || s.phase !== 'decide') return;
  const q = s.pending, p = s.turn, pl = G.current(s);
  const later = () => { note = 'Still to decide.'; render(); };
  let h = '';
  switch (q.kind) {
    case 'buy': {
      const can = pl.cash >= q.price;
      h = lotFacts(q.at) + `<div class="buttons stick">
        <button class="primary" data-c="buy" ${can ? '' : 'disabled'}>Buy it for ${money(q.price)}</button>
        ${can ? '' : `<p class="note">You have ${money(pl.cash)}${pl.debt ? ' and a loan to clear' : ''}.</p>`}
        <button class="secondary" data-c="pass">Leave it</button></div>`;
      break;
    }
    case 'rent': {
      const short = Math.max(0, q.rent - pl.cash);
      const sp = SPACES[q.at];
      h = lotFacts(q.at) + '<div class="buttons stick">';
      h += `<button class="primary" data-c="pay">Pay ${who(q.owner)} ${money(q.rent)}</button>`;
      if (short) h += `<p class="note">You're ${money(short)} short. The bank lends the rest, and adds 10% each time you pass Payday. Money coming in pays it off first.</p>`;
      if (q.buyout != null) {
        const can = pl.cash >= q.buyout;
        h += `<button class="secondary" data-c="buyout" ${can ? '' : 'disabled'}>Make ${who(q.owner)} sell it to you: ${money(q.buyout)}</button>
          <p class="note">Nothing is built here and ${who(q.owner)} ${agree(q.owner, "don't", "doesn't")} own ${sp.type === 'depot' ? 'both depots' : `all of ${DISTRICT[sp.district].name}`}, so ${who(q.owner)} ${agree(q.owner, 'have', 'has')} to sell at ${G.RULES.buyout} times the land value. You pay no rent.</p>`;
      }
      h += '</div>';
      break;
    }
    case 'office': case 'estate': {
      const half = q.kind === 'estate';
      const list = G.emptyLots(s).filter(i => !half || SPACES[i].type === 'lot');
      h = `<h2 id="sheetTitle">${half ? 'Estate sale' : 'Land Office'}</h2><p>${half ? 'Buy any empty lot at half price.' : 'Buy any empty lot or depot in town at its price.'}</p><div class="pick-list">`;
      for (const i of list) {
        const price = half ? Math.round(G.landValue(s, i) / 2 / 5) * 5 : G.landValue(s, i);
        const d = SPACES[i].district;
        h += `<button class="pick" data-c="${i}" ${price > pl.cash ? 'disabled' : ''}>${d ? swatch(d) : '<span class="swatch" style="background:#7d6b5a"></span>'}<span>${esc(SPACES[i].name)}<small>${d ? DISTRICT[d].name + ownedNote(d) : 'Railway'}</small></span><span class="cost">${money(price)}</span></button>`;
      }
      h += `</div><div class="buttons stick"><button class="secondary" data-c="pass">Not today</button></div>`;
      break;
    }
    case 'yard': {
      h = `<h2 id="sheetTitle">Lumberyard</h2><p>Build one level on one of your lots at half price.</p><div class="pick-list">`;
      for (const i of OWNABLE.filter(j => s.owner[j] === p && SPACES[j].type === 'lot')) {
        const c = G.canBuild(s, p, i, 0.5);
        h += `<button class="pick" data-c="${i}" ${c.ok ? '' : 'disabled'}>${swatch(SPACES[i].district)}<span>${esc(SPACES[i].name)}<small>${s.level[i] < G.RULES.maxLevel ? `${G.LEVEL_NAMES[s.level[i] + 1]}: rent ${money(G.rentFor(s, i))} → ${money(G.rentFor(s, i, s.level[i] + 1))}` : 'Built as tall as it goes'}${!c.ok && c.reason && s.level[i] < G.RULES.maxLevel ? ' · ' + esc(c.reason) : ''}</small></span><span class="cost">${c.cost != null ? money(c.cost) : ''}</span></button>`;
      }
      h += `</div><div class="buttons stick"><button class="secondary" data-c="pass">Not today</button></div>`;
      break;
    }
    case 'hall': {
      h = `<h2 id="sheetTitle">City Hall</h2><p>Rezone one district: its land goes up 20%, and so does the rent on every lot in it. Land counts toward what you're worth.</p><div class="pick-list">`;
      for (const d of DISTRICTS) {
        const mine = LOTS_IN[d.id].filter(i => s.owner[i] === p).length;
        h += `<button class="pick" data-c="${d.id}">${swatch(d.id)}<span>${d.name}<small>Land at ${Math.round(s.land[d.id] * 100)}%${mine ? ` · you own ${mine} of 3` : ''}</small></span><span class="cost">↑</span></button>`;
      }
      h += '</div>';
      break;
    }
  }
  const body = openSheet(h, { closable: q.kind !== 'rent' && q.kind !== 'hall' ? true : false, onClose: later });
  if (q.kind === 'buy' || q.kind === 'rent') ring(q.at);
  body.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.c;
    decideWith(/^\d+$/.test(c) ? +c : c);
  }));
}

const ownedNote = d => {
  const p = s.turn, lots = LOTS_IN[d];
  const mine = lots.filter(i => s.owner[i] === p).length;
  return mine ? ` · you own ${mine} of 3` : '';
};

function gazetteHtml(id) {
  const c = CARD[id];
  return `<div class="gazette"><div class="mast">The Boomtown Gazette</div>
    <div class="dateline"><span>Round ${s.round}</span><span>Five cents</span></div>
    <div class="head">${esc(c.head)}</div><div class="body">${esc(c.body)}</div></div>`;
}

function showCard(id) {
  return new Promise(resolve => {
    const body = openSheet(`<h2 id="sheetTitle" class="kicker" style="margin-bottom:10px">Read all about it</h2>${gazetteHtml(id)}
      <div class="buttons"><button class="primary" data-ok>Read on</button></div>`, { closable: false });
    body.querySelector('[data-ok]').addEventListener('click', () => { closeSheet(); resolve(); });
  });
}

let toastTimer = null;
function toastCard(id, ms) {
  const c = CARD[id], t = $('toast');
  t.innerHTML = `<span class="mast">The Boomtown Gazette</span><span class="head">${esc(c.head)}</span><span class="body">${esc(c.body)}</span>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  return wait(Math.min(ms, 1600 * pace()));
}

// ---------- the menu, the log, the rules ----------
$('menuBtn').addEventListener('click', () => {
  if (!s) return;
  const body = openSheet(`<h2 id="sheetTitle">Boomtown</h2>
    <div class="buttons">
      <button class="primary" data-a="back">Back to the game</button>
      <button class="secondary" data-a="rules">How to play</button>
      <div class="row">
        <button class="secondary" data-a="sound" aria-pressed="${soundOn()}">Sound: ${soundOn() ? 'on' : 'off'}</button>
        <button class="secondary" data-a="speed">Pace: ${prefs.speed === 'fast' ? 'fast' : 'easy'}</button>
      </div>
      <button class="secondary" data-a="leave">Leave the table</button>
    </div>
    <p class="note">Leaving keeps this game: carry on from the title screen.</p>
    <footer class="jd-foot"><a href="https://junkdrawer.works/">Part of junkdrawer.works</a> <span aria-hidden="true">·</span> <a href="https://junkdrawer.works/privacy.html">Privacy</a></footer>`);
  body.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') closeSheet();
    if (a === 'rules') showRules();
    if (a === 'sound') { prefs.sound = !soundOn(); setSound(prefs.sound); store.set(PREFS, prefs); e.target.textContent = `Sound: ${prefs.sound ? 'on' : 'off'}`; }
    if (a === 'speed') { prefs.speed = prefs.speed === 'fast' ? 'normal' : 'fast'; store.set(PREFS, prefs); e.target.textContent = `Pace: ${prefs.speed === 'fast' ? 'fast' : 'easy'}`; }
    if (a === 'leave') showTitle();
  });
});

$('logBtn').addEventListener('click', () => {
  if (!s) return;
  openSheet(`<h2 id="sheetTitle">What happened</h2><ol class="log in-sheet">${logSheetHtml()}</ol>`);
});

function showRules() {
  openSheet(`<div class="rules"><h2 id="sheetTitle">How to play</h2>
    <p>Boomtown is a town that isn't built yet. Go round the board buying lots and building on them. When the last round ends it's Founders' Day, and whoever is worth the most wins: cash, plus land, plus buildings, less any loan.</p>
    <h3>Your turn</h3>
    <ul>
      <li><b>Roll two dice and move by both.</b> Or take a <b>detour</b> and move by just one of them. You have two detours; passing Payday gives one back.</li>
      <li><b>Land on a lot for sale</b> and you can buy it.</li>
      <li><b>Land on someone else's lot</b> and you pay them rent. If nothing is built on it and they don't own the whole district, you can make them sell it to you instead, for ${G.RULES.buyout} times the land value.</li>
      <li><b>Then build</b> on any of your lots: a house, then a shop, then a block. A block needs all three lots in the district.</li>
      <li><b>Whoever goes later starts with a little more:</b> ${money(G.RULES.seatBonus)} for each seat after the first.</li>
    </ul>
    <h3>How the town grows</h3>
    <ul>
      <li><b>Every building lifts the street.</b> It raises the land value of its whole district, and adds a quarter to the rent of the other lots there, whoever owns them.</li>
      <li><b>Own a whole district</b> and its rents go up: double on empty lots, and half as much again on built ones.</li>
      <li><b>The Gazette</b> brings news: a district booms or busts, a fair pays out, the pipes burst.</li>
    </ul>
    <h3>The corners</h3>
    <ul>
      <li><b>Payday:</b> ${money(G.RULES.salary)} as you pass, ${money(G.RULES.salary + G.RULES.landBonus)} if you land on it.</li>
      <li><b>Land Office:</b> buy any empty lot in town.</li>
      <li><b>Town Square:</b> take the kitty, where fines and taxes collect.</li>
      <li><b>City Hall:</b> rezone a district, putting its land up 20%.</li>
    </ul>
    <h3>Running short</h3>
    <ul>
      <li><b>Nobody goes out.</b> If you can't pay, the bank lends you the rest and adds 10% each time you pass Payday. Money coming in pays it off first. You can sell buildings back for half what they cost.</li>
    </ul></div>`);
}

function showRecords() {
  const r = store.get(RECORDS, { played: 0, won: 0, best: 0 });
  openSheet(`<h2 id="sheetTitle">Records</h2>
    <table class="facts"><tr><td>Games finished</td><td>${r.played}</td></tr><tr><td>Won by a person</td><td>${r.won}</td></tr>
    <tr><td>Best worth on Founders' Day</td><td>${r.best ? money(r.best) : '—'}</td></tr></table>
    <p class="note">Kept on this device only.</p>`);
}

// ---------- Founders' Day ----------
function finish() {
  const st = G.standings(s);
  const winner = s.players[st[0].p];
  // Records, once per game.
  if (!s.recorded && s.players.some(p => p.kind === 'human')) {
    const r = store.get(RECORDS, { played: 0, won: 0, best: 0 });
    r.played++;
    if (winner.kind === 'human') r.won++;
    for (const x of st) if (s.players[x.p].kind === 'human') r.best = Math.max(r.best, x.worth);
    store.set(RECORDS, r);
  }
  s.recorded = true;
  save();
  const head = `${Who(st[0].p)} ${agree(st[0].p, 'are', 'is')} the richest in Boomtown`;
  const rows = st.map(x => `<li>${art.tokenSvg(s.players[x.p].token, 28)}<span class="nm">${nm(x.p)}<small>${money(x.cash)} cash · ${money(x.land)} land · ${money(x.buildings)} buildings</small></span><span class="w">${money(x.worth)}</span></li>`).join('');
  const body = openSheet(`<div class="gazette"><div class="mast">The Boomtown Gazette</div>
      <div class="dateline"><span>Founders' Day</span><span>Special edition</span></div>
      <div class="head" id="sheetTitle">${head}</div></div>
    <ol class="standings">${rows}</ol>
    <h3>Worth, round by round</h3>${chart()}
    <div class="buttons"><button class="primary" data-a="again">Play again</button><button class="secondary" data-a="title">Change players</button><button class="ghost" data-a="board">Look at the town</button></div>`, { closable: true });
  body.querySelector('[data-a="again"]').addEventListener('click', () => {
    const seats = s.players.map(p => ({ name: p.name, kind: p.kind, bot: p.bot, token: p.token }));
    startGame(G.newGame({ seats, rounds: s.rounds }));
  });
  body.querySelector('[data-a="title"]').addEventListener('click', () => { store.del(KEY); showTitle(); });
  body.querySelector('[data-a="board"]').addEventListener('click', () => {
    closeSheet();
    note = `${head}. <button class="link" id="againLink">See the results</button>`;
    render();
    const again = $('againLink');
    if (again) { again.onclick = finish; again.focus({ preventScroll: true }); }
  });
}

function chart() {
  const W = 400, H = 170, pad = 46;
  const all = s.players.flatMap(p => p.history);
  const max = Math.max(...all, 1), min = Math.min(0, ...all), n = Math.max(...s.players.map(p => p.history.length)) - 1 || 1;
  const x = k => pad + (k / n) * (W - pad - 8), y = v => H - 18 - ((v - min) / (max - min)) * (H - 30);
  let g = `<line x1="${pad}" y1="${y(0)}" x2="${W - 8}" y2="${y(0)}" stroke="#0003"/>`;
  g += `<text x="${pad - 4}" y="${y(max) + 4}" text-anchor="end">${money(Math.round(max / 100) * 100)}</text><text x="${pad - 4}" y="${y(0) + 4}" text-anchor="end">$0</text>`;
  g += `<text x="${pad}" y="${H - 2}">Start</text><text x="${W - 8}" y="${H - 2}" text-anchor="end">Round ${n}</text>`;
  // Read out, the lines come down to where each player ended, richest first.
  const ended = G.standings(s).map((x, k) => `${esc(s.players[x.p].name)}${k ? '' : ' ended'} on ${money(x.worth)}`).join(', ');
  s.players.forEach((p, q) => {
    g += `<polyline fill="none" stroke="${colorOf(q)}" stroke-width="3" stroke-linejoin="round" points="${p.history.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Each player's worth, round by round. ${ended}.">${g}</svg>`;
}

// ---------- fitting the board to the screen ----------
// On a wide screen the board is square, beside the players. On a phone held upright it stands taller than it is
// wide, with the players underneath, so the spaces down the sides and the middle of the board get more room.
function fit() {
  const vw = innerWidth, vh = innerHeight, root = document.documentElement.style;
  let w, H;
  if (vw >= 900) { H = 900; w = Math.min(vh - 70, vw - 400, 860); }
  else {
    H = vh / vw > 1.45 ? 1260 : 900;
    w = Math.min(vw - 16, (vh - 250) * 900 / H, 640);
  }
  w = Math.max(260, Math.floor(w));
  const h = Math.round(w * H / 900);
  root.setProperty('--bw', w + 'px');
  root.setProperty('--bh', h + 'px');
  root.setProperty('--ctop', (150 / H * 100) + '%');
  root.setProperty('--cheight', ((H - 300) / H * 100) + '%');
  view.setHeight(H);
}
addEventListener('resize', fit);
fit();

// ---------- start ----------
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
if ('serviceWorker' in navigator && window.isSecureContext && !window.BOOMTOWN_ARTIFACT) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// For tests and screenshots: window.boomtown gives the state.
window.boomtown = { get state() { return s; }, get busy() { return busy; }, G, start: startGame, render };
showTitle(false);

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
import { copy, step } from './shown.js';

const $ = id => document.getElementById(id);
const KEY = 'boomtown.game', PREFS = 'boomtown.prefs', RECORDS = 'boomtown.records';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* as above */ } },
  // Whether anything is kept at all: not in a browser that blocks it, or a sandboxed frame.
  works() { try { localStorage.setItem('boomtown.check', '1'); localStorage.removeItem('boomtown.check'); return true; } catch { return false; } },
};
// The one-file copy (scripts/build.mjs) plays inside another page's frame: its links open beside it, not in its place,
// which would end the game held in memory there.
const LINK_TARGET = window.BOOMTOWN_ARTIFACT ? ' target="_blank" rel="noopener"' : '';

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
let shown = null;              // while a move plays out, the game as the screen has shown it so far (see shown.js)
let takeBack = null;           // the game as it was before the person's last choice this turn, to take it back (see keep)
const view = createBoard($('board'), { onCell: i => showSpace(i), onDest: i => onDest(i) });

const wait = ms => new Promise(r => setTimeout(r, ms));
const pace = () => (prefs.speed === 'fast' ? 0.35 : 1);

// A tap on the middle of the board, or on Hurry … along under the line there, during a townsperson's turn plays the
// rest of that turn at once: no pauses and no sounds, and the piece jumps to where it ends up. The money still floats,
// the log and the cards still say what happened, and a headline still shows a moment. Their next turn goes at the usual
// pace again.
let hurryAt = null; // the turn that was hurried, as `round:seat`
const turnKey = () => `${s.round}:${s.turn}`;
const hurried = () => !!s && hurryAt === turnKey();
const wakers = new Set(); // the pauses under way, which a hurry cuts short
// A pause in the play of a turn, which a hurry cuts short or skips.
const nap = ms => (hurried() ? Promise.resolve() : new Promise(r => {
  const done = () => { clearTimeout(t); wakers.delete(done); r(); };
  const t = setTimeout(done, ms);
  wakers.add(done);
}));
const hush = Object.fromEntries(Object.keys(sfx).map(k => [k, () => {}]));
function hurry() {
  if (!s || s.phase === 'over' || G.current(s).kind !== 'bot' || hurried()) return;
  hurryAt = turnKey();
  [...wakers].forEach(w => w());
  view.rush();
}
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
// Chromium draws the keyboard's ring on a button the focus is moved to even after a tap (the button tapped has gone, so
// it can't tell), so the page notes whether the last thing the person did was a tap or a key: after a tap or a click
// the ring isn't drawn (see .tapped in app.css).
addEventListener('pointerdown', () => document.documentElement.classList.add('tapped'), true);
addEventListener('keydown', () => document.documentElement.classList.remove('tapped'), true);

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
  for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String((prefs.speed === 'fast' ? 'fast' : 'normal') === b.dataset.speed));
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

// The pace, as in the menu: how long the game lingers on each thing that happens.
$('paces').addEventListener('click', e => {
  const b = e.target.closest('button[data-speed]');
  if (!b) return;
  prefs.speed = b.dataset.speed;
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
  const solo = game.players.filter(p => p.kind === 'human').length === 1; // one person: the game is with the others
  const names = game.players.filter(p => !solo || p.kind !== 'human').map(p => p.name);
  return `Round ${game.round} of ${game.rounds}, ${solo ? 'with ' : ''}${and(names)}`;
}
$('resumeBtn').addEventListener('click', () => {
  const game = unfinished();
  if (game) startGame(game, true);
});
$('rulesBtn').addEventListener('click', showRules);
$('recordsBtn').addEventListener('click', showRecords);

function startGame(game, resumed = false, again = false) {
  s = game;
  s.log ||= [];
  gen++;
  closeSheet(); // Play again starts from Founders' Day's sheet
  unused = null;
  // Nothing from the last game carries into this one: a hurry (keyed on round and seat, which come round again), the
  // copy a move was being shown on, or a headline or banner still up.
  hurryAt = null;
  shown = null;
  takeBack = null;
  clearTimeout(toastTimer); $('toast').hidden = true;
  clearTimeout(bannerTimer); $('banner').hidden = true;
  $('title').hidden = true;
  $('app').hidden = false;
  view.reset();
  const first = again ? ` ${Who(0)} ${agree(0, 'go', 'goes')} first this time.` : '';
  note = resumed ? `Back in Boomtown. ${whoseTurn()}` : `Ground broken. Every lot is for sale.${first}`;
  if (!resumed) { addLog(`A new game: ${s.rounds} rounds, ${s.players.length} players.${first}`); addLog(`Round ${s.round}`); save(); }
  render();
  fit(); // now the players' cards can be measured
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
  // The board, the cards, the dice and the round show the game as far as the move has been shown (see play()).
  const v = shown || s;
  const last = v.phase !== 'over' && v.round === v.rounds;
  $('round').textContent = v.phase === 'over' ? "Founders' Day" : last ? 'Last round' : `Round ${v.round} of ${v.rounds}`;
  $('round').classList.toggle('last', last);
  // Board marks: where the dice can take you, what you can build on.
  let dests = [], buildable = [];
  // A screen reader hears the same on each space: where a move lands, and what can be built on.
  const labels = {};
  if (human && s.phase === 'move') {
    dests = G.moveOptions(s).map(o => {
      labels[o.to] = `${o.detour ? 'Detour' : 'Both dice'}, ${o.steps}: ${o.usable ? 'lands here' : 'no detours left'}.`;
      return { to: o.to, label: o.steps, usable: o.usable, detour: o.detour };
    });
  }
  if (human && s.phase === 'manage') {
    buildable = OWNABLE.filter(i => G.canBuild(s, p, i).ok);
    for (const i of buildable) labels[i] = 'You can build here.';
  }
  view.render(v, { dests, buildable, focus: ringed, labels });
  drawPlayers(v);
  drawLogList();
  drawDice(v);
  setSay(note);
  // The buttons in the middle. Emptying them drops the focus if it was on one, so it's put back on the new main button,
  // unless the person is somewhere else (a space on the board, a sheet).
  const a = $('actions');
  const was = document.activeElement, refocus = adrift(was) || a.contains(was);
  $('center').classList.toggle('choosing', human && s.phase === 'move'); // see .center.choosing in the css
  if (s.phase !== 'over' && G.current(s).kind === 'bot') { hurryButton(a, refocus); return; }
  a.innerHTML = '';
  if (!human) return;
  if (takeBack) {
    const b = btn('Take it back', 'link undo', takeItBack);
    b.setAttribute('aria-label', `Take back ${takeBack.what}`);
    a.append(b);
  }
  if (s.phase === 'roll') {
    const since = sinceLine(p);
    if (since) { const el = document.createElement('p'); el.className = 'since'; el.innerHTML = since; a.append(el); }
    a.append(btn('Roll the dice', 'primary big', onRoll, true));
    if (OWNABLE.some(i => s.owner[i] === p)) a.append(btn('Your lots', 'ghost', () => showLots()));
  } else if (s.phase === 'move') {
    for (const o of G.moveOptions(s)) {
      // All alike, cream, so none looks like the one to take: the edge and the number are the colour of the move's badge
      // on the board, brick for both dice and gold for a detour.
      const b = btn('', 'secondary move-btn ' + (o.detour ? 'detour' : 'both'), () => onMove(o), o.usable && !a.querySelector('[data-main]'));
      b.disabled = !o.usable;
      b.innerHTML = `<span class="n">${o.steps}</span><span class="what"><b>${o.detour ? 'Detour, one die' : 'Both dice'}</b>${preview(o)}</span>`;
      a.append(b);
    }
    const d = document.createElement('div');
    d.className = 'detours';
    // One line, even on a small phone. Payday gives one back only below the most you can hold.
    d.textContent = !pl.detours ? 'No detours left until Payday.'
      : pl.detours >= G.RULES.detourMax ? `Detours ${'◆'.repeat(pl.detours)} (all you can hold)` : `Detours ${'◆'.repeat(pl.detours)} · one back at Payday`;
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

// While a townsperson plays, the one button in the middle hurries them along (see hurry()). It's kept from one redraw
// to the next, and from one townsperson to the next, so the focus stays on it: Enter again hurries the next one.
function hurryButton(a, refocus) {
  let b = a.querySelector('.hurry');
  if (!b || a.children.length !== 1) {
    a.innerHTML = '';
    b = document.createElement('button');
    b.className = 'link hurry'; // its tap is the board's (see the board's listener below)
    a.append(b);
  }
  const text = `Hurry ${G.current(s).name} along`;
  if (b.textContent !== text) b.textContent = text;
  if (refocus && $('sheetWrap').hidden && document.activeElement !== b) b.focus({ preventScroll: true });
}
// A tap on the board that isn't on a space (whose sheet it opens) or on another button hurries the townsfolk.
document.querySelector('.board-wrap').addEventListener('click', e => {
  if (!e.target.closest('.cell, .badge, a, button:not(.hurry)')) hurry();
});

function btn(text, cls, fn, main = false) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  if (main) b.dataset.main = '';
  b.addEventListener('click', () => { if (!busy) fn(); });
  return b;
}

// The game as it would be on arriving, with the cash you'll have there (Payday on the way counts, and a loan it pays
// off): the move made on a copy of the game. Null for a detour with none left, which can't be taken anyway.
function arrival(o) {
  try {
    const t = JSON.parse(JSON.stringify({ ...s, log: [], since: null }));
    G.move(t, o.steps, o.detour);
    return t;
  } catch { return null; }
}

// Would this move get the Lumberyard's question? Only with something of yours that can go up at half price.
function yardAsks(o) {
  const t = arrival(o);
  return t ? t.pending?.kind === 'yard' : true;
}

// Could you make the owner sell you this lot, with the cash you'll have there? Not put in the preview in the final
// round, where the sale costs half as much again as the land adds to your worth on Founders' Day (the townsfolk don't
// force one then either); the rent sheet still offers it.
function saleOffered(o) {
  if (s.round === s.rounds) return null;
  const t = arrival(o), q = t?.pending;
  return q?.kind === 'rent' && q.buyout != null && q.buyout <= t.players[s.turn].cash ? q.buyout : null;
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
      else {
        const sale = saleOffered(o);
        parts.push(`${esc(sp.name)}: rent <span class="rent" style="color:${art.tagColor(colorOf(w))}">${money(G.rentFor(s, o.to))}</span> to ${nm(w)}${sale != null ? ` · or make them sell, ${money(sale)}` : ''}`);
      }
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

function drawDice(s) {
  const el = $('dice');
  // Emptied, it forgets what it showed: the next roll may be the same pair, and must still be drawn.
  if (!s.dice || s.phase === 'over') { el.innerHTML = ''; delete el.dataset.v; return; }
  if (el.dataset.v !== s.dice.join()) {
    el.innerHTML = s.dice.map(v => `<span class="die">${art.dieFace(v)}</span>`).join('');
    el.dataset.v = s.dice.join();
  }
  [...el.children].forEach((d, k) => d.classList.toggle('used', k === unused));
}

function drawPlayers(s) {
  const el = $('players');
  const cards = s.players.map((pl, p) => {
    const worth = G.netWorth(s, p);
    const detours = `${pl.detours} detour${pl.detours === 1 ? '' : 's'}`;
    const now = p === s.turn && s.phase !== 'over';
    // Rows that never change shape: the piece, name and cash, what they're worth (or what they owe while they owe it),
    // and their detours. Beside the board they're two rows; on a phone, in one row of compact cards, three (see .chip
    // in the css). Whose turn it is (the gold outline) and where each piece stands are written out for a screen reader.
    // $10,000 and up, worth or cash, takes less room on a small phone: see .chip.long in the css.
    const long = (!pl.debt && money(worth).length > 6 ? ' long' : '') + (money(pl.cash).length > 6 ? ' rich' : '');
    return {
      cls: `chip${now ? ' now' : ''}${long}`,
      // A card is a button (it opens the player's sheet), so the label carries all it says, where they stand included.
      label: `${pl.name}: ${money(pl.cash)} cash${pl.debt ? `, owes ${money(pl.debt)}` : ''}, worth ${money(worth)}, ${detours}. ${now ? 'Playing now. ' : ''}On ${place(pl.pos)}.`,
      inner: `<span class="tk">${art.tokenSvg(pl.token, 30)}</span><span class="nm">${esc(pl.name)}</span><span class="cash">${money(pl.cash)}</span>
      ${pl.debt ? `<span class="sub debt">owes ${money(pl.debt)}</span>` : `<span class="sub worth"><span class="lbl">worth </span>${money(worth)}</span>`}<span class="dt" title="${detours}" aria-hidden="true">${'◆'.repeat(pl.detours)}</span>
      <span class="vh">${now ? 'Playing now. ' : ''}On ${place(pl.pos)}.</span>`,
    };
  });
  // Each card is changed in place, not replaced, so a card lighting up (see flashCard) carries on while its cash changes.
  // A tap on a card (or Enter on it) opens that player's sheet: see showPlayer.
  if (el.children.length !== cards.length) el.innerHTML = cards.map(() => '<div role="button" tabindex="0"></div>').join('');
  cards.forEach((c, p) => {
    const card = el.children[p], h = c.cls + c.label + c.inner;
    if (card._h === h) return;
    card._h = h;
    const lit = ['flash', 'shake'].filter(k => card.classList.contains(k));
    card.className = [c.cls, ...lit].join(' ');
    card.setAttribute('aria-label', c.label);
    card.innerHTML = c.inner;
  });
}

$('players').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (c) showPlayer([...$('players').children].indexOf(c));
});
$('players').addEventListener('keydown', e => {
  const c = e.target.closest('.chip');
  if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showPlayer([...$('players').children].indexOf(c)); }
});

// A huge rent: $250 or more, and a quarter or more of what the payer was worth before paying it. About three in a
// four-player game of 20 rounds, under one in a two-player game.
const hugeRent = e => typeof e.to === 'number' && e.why.startsWith('rent') && e.amount >= 250 && e.amount * 4 >= G.netWorth(shown || s, e.from) + e.amount;
// A player's card shakes: a huge rent went out of it.
function shakeCard(p) {
  const c = $('players').children[p];
  if (!c) return;
  c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
  setTimeout(() => c.classList.remove('shake'), 600);
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
    await nap((s.phase === 'roll' ? 550 : s.phase === 'manage' ? 380 : 520) * pace());
    if (my !== gen) return;
    // A sheet the person opened (a lot, the menu) holds the townsfolk until it's closed, so what it says stays true.
    // Only one the person can close: the townsfolk never wait on a sheet nobody can shut.
    while (!$('sheetWrap').hidden && $('scrim').onclick) {
      await wait(150);
      if (my !== gen) return;
    }
    const asked = s.phase === 'decide' ? { ...s.pending, p: s.turn, cash: G.current(s).cash } : null;
    const before = copy(s);
    const ev = declined(asked, botStep(s));
    save();
    await play(ev, my, before);
    if (my !== gen) return;
  }
  if (my !== gen || !s) return;
  if (s.phase === 'over') {
    // A moment on the finished town, bunting up, before the special edition.
    render();
    await wait(1200);
    if (my === gen) celebrate();
    return;
  }
  if (s.phase === 'roll') note = whoseTurn();
  render();
  if (s.phase === 'decide') askDecision();
}

async function onRoll() {
  const my = gen;
  takeBack = null; // a roll is never taken back
  if (s.since) s.since[s.turn] = [];
  const before = copy(s);
  const ev = G.roll(s);
  save();
  await play(ev, my, before);
  note = humans() > 1 ? `${nm(s.turn)}: move by both dice, or take a detour.` : 'Move by both dice, or take a detour by one.';
  render();
}

async function onMove(o) {
  const my = gen, before = copy(s);
  keep('that move');
  const ev = G.move(s, o.steps, o.detour);
  if (ev.some(e => e.t === 'card')) takeBack = null; // the Gazette's headline is read: the move stands
  save();
  note = '';
  await play(ev, my, before);
  if (my !== gen) return;
  if (s.phase === 'decide') { if (!note) note = landedNote(true); render(); askDecision(); return; }
  // A line that says only how you moved (a detour, passing Payday) is followed by where you are.
  const told = ev.some(e => e.t === 'card' || e.t === 'kitty' || e.t === 'pay' || (e.t === 'collect' && e.why !== 'Payday'));
  note = !note ? landedNote() : told ? note : `${note} ${landedNote(true)}`;
  render();
}

// A tap on a space the dice reach makes that move, as its button does; a greyed one (a detour with none left) says why
// it can't.
function onDest(to) {
  if (!s || busy || !isHumanTurn() || s.phase !== 'move') return;
  const o = G.moveOptions(s).find(x => x.to === to); // the moves always reach different spaces
  if (!o) return;
  if (!o.usable) { note = 'No detours left until Payday.'; render(); return; }
  onMove(o);
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
  const my = gen, before = copy(s);
  takeBack = null;
  const ev = G.endTurn(s);
  save();
  await play(ev, my, before);
  run();
}

async function decideWith(choice) {
  const my = gen;
  closeSheet();
  const asked = { ...s.pending, p: s.turn, cash: G.current(s).cash };
  const before = copy(s);
  // A rent with no forced sale to make instead has one answer, so there's nothing to take back: the copy kept before
  // the move that landed there stays, and takes that back instead.
  if (asked.kind !== 'rent' || (asked.buyout != null && asked.buyout <= asked.cash)) keep(choiceWords(asked, choice));
  const ev = G.decide(s, choice);
  if (humans() > 1) declined(asked, ev); // passing the phone, the others weren't looking
  save();
  await play(ev, my, before);
  if (my !== gen) return;
  if (isHumanTurn()) { if (!note) note = landedNote(); render(); }
}

async function doBuild(i) {
  const my = gen, before = copy(s);
  keep(`building on ${SPACES[i].name}`);
  const ev = G.build(s, i);
  save();
  await play(ev, my, before);
  render();
}

async function doSell(i) {
  const my = gen, before = copy(s);
  keep(`selling on ${SPACES[i].name}`);
  const ev = G.sell(s, i);
  save();
  await play(ev, my, before);
  render();
}

// ---------- take it back ----------
// Before each choice a person makes on their turn (a move, buy or leave a lot, pay or make the owner sell, build, sell,
// the Land Office's or a corner's pick) the game keeps a copy of itself, and Take it back, under the line in the middle,
// puts it back: the one last choice, until the turn ends. A roll is never taken back, nor a move that drew a Gazette
// headline. The game is one object with its own dice, so a copy put back can't roll anything differently. The
// townsfolk never take anything back, and in a game of several people only the one whose turn it is can, their own.
// `what` names the choice in words: 'buying Ferry Landing'.
function keep(what) { takeBack = { game: JSON.stringify(s), what }; }
function choiceWords(q, c) {
  const at = typeof c === 'number' ? SPACES[c].name : '';
  switch (q.kind) {
    case 'buy': return c === 'buy' ? `buying ${SPACES[q.at].name}` : `leaving ${SPACES[q.at].name} for sale`;
    case 'rent': return c === 'buyout' ? `making ${W.who(s.players[q.owner])} sell ${SPACES[q.at].name}` : 'paying the rent';
    case 'office': case 'estate': return c === 'pass' ? 'buying nothing' : `buying ${at}`;
    case 'yard': return c === 'pass' ? 'building nothing' : `building on ${at}`;
    case 'hall': return `rezoning ${DISTRICT[c].name}`;
  }
  return 'that';
}
function takeItBack() {
  if (!takeBack || busy || !isHumanTurn()) return;
  const { game, what } = takeBack;
  takeBack = null;
  s = JSON.parse(game);
  // The pieces go back where the copy has them, and a headline or banner from the choice comes down.
  s.players.forEach((pl, p) => { view.shown[p] = pl.pos; });
  clearTimeout(toastTimer); $('toast').hidden = true;
  clearTimeout(bannerTimer); $('banner').hidden = true;
  if (s.phase === 'move') unused = null;
  const line = `${Who(s.turn)} took back ${esc(what)}.`;
  addLog(line);
  note = s.phase === 'move' ? `${line} Move by both dice, or take a detour by one.` : s.phase === 'manage' ? `${line} ${landedNote()}` : line;
  save();
  render();
  if (s.phase === 'decide') askDecision();
}

// Show a list of events: move the pieces, float the money, read the Gazette, and write it all in the log. `before` is
// the game as it stood before them: the screen shows a copy of it, stepped on as each event is shown, so the cash on
// the cards, the tags on the board and the dice change as the story plays out, not all at once when the move is made.
async function play(events, my = gen, before = null) {
  busy = true;
  shown = before;
  render();
  const k = pace(), bot = G.current(s).kind === 'bot';
  let detour = false;
  try {
    for (const e of events) {
      if (my !== gen) return;
      if (shown) { step(shown, e); render(); }
      const sf = hurried() ? hush : sfx;
      const line = describe(e);
      addLog(line);
      noteSince(e);
      switch (e.t) {
        case 'roll': {
          sf.dice();
          unused = null;
          drawDice(shown || s);
          const d = $('dice');
          d.classList.remove('rolling'); void d.offsetWidth; d.classList.add('rolling');
          note = line;
          setSay(note);
          await nap(500 * k);
          break;
        }
        case 'detour': note = line; setSay(note); detour = true; break;
        case 'move': {
          const ms = calm() || hurried() ? 0 : (bot ? 120 : 140) * k;
          const steps = e.path.length;
          if (detour && s.dice) { unused = s.dice[0] === steps ? 1 : 0; detour = false; drawDice(shown || s); } // dim the other die
          if (ms) for (let j = 0; j < steps; j++) setTimeout(() => sf.hop(), j * ms);
          else sf.hop();
          await view.animateMove(s, e.p, e.path, ms, hurried);
          // Where the townsfolk went, for anyone listening rather than watching.
          if (bot) { note = `${nm(e.p)} to ${place(e.path[steps - 1])}.`; setSay(note); }
          break;
        }
        case 'collect':
          if (e.why === 'selling up') break;
          view.float(s.players[e.p].pos, `+${money(e.amount)}`, '#1f7a46');
          if (e.why.startsWith('Payday')) sf.payday(); else sf.coin();
          note = line || note; render();
          await nap(450 * k);
          break;
        case 'pay': {
          if (e.to === 'bank') break; // a purchase: the buy or build event shows it
          const huge = hugeRent(e);
          view.float(s.players[e.from].pos, `−${money(e.amount)}`, '#b23a2a', huge ? 1900 : 1300, huge ? 'big' : '');
          note = line || note; render();
          if (typeof e.to === 'number') {
            // Rent and forced sales: out of one piece and, a beat later, into the other. A person hears the coin when
            // the money comes to them from one of the townsfolk. A huge rent lands harder: a bigger float, the payer's
            // card shakes, and a low thud.
            const to = e.to, kind = p => s.players[p].kind;
            if (huge) { sf.thud(); shakeCard(e.from); } else if (kind(to) === 'human' && kind(e.from) !== 'human') sf.coin(); else sf.pay();
            setTimeout(() => { if (my !== gen) return; view.float(s.players[to].pos, `+${money(e.amount)}`, '#1f7a46'); flashCard(to); }, 250 * k);
          } else sf.pay();
          await nap((huge ? 1000 : 600) * k);
          break;
        }
        case 'loan': note += ` ${line}`; render(); await nap(400 * k); break;
        case 'buy': case 'buyout': {
          // A forced sale stamps SOLD across the lot. A person made to sell gets a headline, and long enough to read it.
          const forced = e.t === 'buyout', person = forced && s.players[e.from].kind === 'human';
          if (forced) { sf.sold(); view.stamp(e.at); } else sf.stamp();
          render(); view.pop(e.at); note = line; setSay(note);
          if (person) toast(`${Who(e.p)} made ${who(e.from)} sell ${esc(SPACES[e.at].name)}`, `${money(e.price)} for land worth ${money(G.landValue(shown || s, e.at))}.`, 3200 * k);
          await nap((person ? 1200 : 550) * k);
          // The lot that makes a whole district (or both depots) one player's gets a banner in the district's colour.
          const v = shown || s, d = SPACES[e.at].district;
          if (d ? G.ownsDistrict(v, e.p, d) : DEPOTS.every(x => v.owner[x] === e.p)) {
            sf.fanfare();
            addLog(banner(e.p, d, 2800 * k));
            await nap(1400 * k);
          }
          break;
        }
        case 'build': case 'sell':
          if (e.t === 'build') sf.build(); else sf.pay();
          render(); view.pop(e.at); note = line; setSay(note);
          await nap(500 * k);
          break;
        case 'land': {
          // Every lot in the district says how far its land moved, so the street can be seen rising when someone builds.
          const by = Math.round((e.to - e.from) * 100);
          for (const i of LOTS_IN[e.d]) view.float(i, `${by > 0 ? '+' : '−'}${Math.abs(by)}%`, by > 0 ? '#1f7a46' : '#b23a2a', 1500, 'small');
          break;
        }
        case 'card': {
          sf.paper();
          render();
          // The townsfolk's news shows as a toast, which is read out itself: the line in the middle doesn't say it again.
          if (bot || !isHumanTurn()) await toastCard(e.card, 2400 * k);
          else { await showCard(e.card); note = `<b>${esc(CARD[e.card].head)}.</b>`; }
          break;
        }
        case 'kitty': note = line; render(); break;
        case 'left': case 'spared': note = line; setSay(note); await nap(550 * k); break;
        case 'rezone': sf.stamp(); note = line; render(); await nap(500 * k); break;
        case 'interest': case 'repaid': render(); break;
        case 'turn': if (e.p === 0) addLog(`Round ${e.round}`); note = whoseTurn(); break;
        case 'over': note = line; setSay(note); break;
      }
    }
  } finally {
    busy = false;
    shown = null;
  }
  render();
}

// What a player chose not to do has no event of its own: a lot left for sale, a forced sale not made. So it isn't
// missed, the decision's events get one more line: asked is the question as it stood, with who answered it and the
// cash they had. Only the line and the log say it, not what happened since your turn.
function declined(asked, ev) {
  if (asked?.kind === 'buy' && !ev.some(e => e.t === 'buy')) ev.push({ t: 'left', p: asked.p, at: asked.at });
  else if (asked?.kind === 'rent' && asked.buyout != null && asked.buyout <= asked.cash && !ev.some(e => e.t === 'buyout'))
    ev.push({ t: 'spared', p: asked.p, from: asked.owner, at: asked.at });
  return ev;
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
  const moved = landMoved; // a rezoning's line says how far the land went, from the 'land' event just before it
  if (e.t === 'land') landMoved = e;
  else if (e.t !== 'collect' && e.t !== 'repaid' && e.t !== 'sell') landMoved = null; // a sale's own: land, collect, repaid, sell
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
    case 'left': return `${nm(e.p)} left ${sp(e.at)} for sale.`;
    case 'spared': return `${nm(e.p)} paid the rent rather than make ${who(e.from)} sell.`;
    case 'build': return `${nm(e.p)} built a ${G.LEVEL_NAMES[e.level].toLowerCase()} on ${sp(e.at)}.`;
    case 'sell': {
      const d = SPACES[e.at].district, fell = landMoved?.d === d ? Math.round((landMoved.from - landMoved.to) * 100) : 0;
      landMoved = null;
      return `${nm(e.p)} sold the ${G.LEVEL_NAMES[e.level + 1].toLowerCase()} on ${sp(e.at)} back for ${money(e.refund)}.${fell > 0 ? ` ${DISTRICT[d].name} land fell ${fell}%.` : ''}`;
    }
    case 'card': return `The Gazette: ${esc(CARD[e.card].head)}.`;
    case 'kitty': return `${nm(e.p)} took the kitty: ${money(e.amount)}.`;
    case 'rezone': {
      const up = moved?.d === e.d ? moved : null, { pct } = W;
      return `${nm(e.p)} rezoned ${DISTRICT[e.d].name}: ${up ? `land up from ${pct(up.from)} to ${pct(up.to)}` : 'its land was already as high as land goes'}.`;
    }
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

const lotFacts = (i, o) => W.lotFacts(shown || s, i, o); // a lot looked at mid-move is as the board shows it

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
    if (sp.type === 'tax') h += `<p>Pay ${W.SAYS.tax}.</p>`;
    if (sp.type === 'square') h += `<p>The kitty holds <b>${money(s.kitty)}</b>.</p>`;
    if (sp.type === 'payday') h += `<p>Pay is ${money(G.RULES.salary)}, or ${money(G.RULES.salary + G.RULES.landBonus)} for landing on it. Passing it also gives back a detour, and adds interest to any loan.</p>`;
  }
  const body = openSheet(h, { light: true });
  ring(i);
  body.querySelector('[data-build]')?.addEventListener('click', () => { closeSheet(); doBuild(i); });
  body.querySelector('[data-sell]')?.addEventListener('click', () => { closeSheet(); doSell(i); });
}

// The current player's lots, with build and sell buttons. After a build or a sale it opens again where it was:
// scrolled to `at.scroll`, with the focus on the same lot's button (`at.focus`), or on its row once that's gone.
function showLots(at = null) {
  const p = s.turn;
  const mine = OWNABLE.filter(i => s.owner[i] === p);
  const canAct = isHumanTurn() && (s.phase === 'manage' || s.phase === 'roll'); // selling waits till the move is done
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
    const next = lv < G.RULES.maxLevel ? `${G.LEVEL_NAMES[lv + 1]}: rent ${money(W.rentAfterBuild(s, i))}` : 'Built as tall as it goes';
    h += `<div class="pick" data-lot="${i}" style="grid-template-columns: 14px 1fr auto auto; cursor:default">${swatch(sp.district)}
      <span>${esc(sp.name)}<small>${G.LEVEL_NAMES[lv]}, rent ${money(G.rentFor(s, i))} · ${s.phase === 'manage' && !c.ok && c.reason && lv < G.RULES.maxLevel ? esc(c.reason) : next}</small>${G.buyoutPrice(s, i) != null ? `<small class="warn">Empty: a rival can make you sell for ${money(G.buyoutPrice(s, i))}</small>` : ''}</span>
      ${canAct && G.canSell(s, p, i) ? `<button class="secondary sell" data-sell="${i}" aria-label="Sell the ${G.LEVEL_NAMES[lv].toLowerCase()} on ${esc(sp.name)} back for ${money(G.sellValue(i))}">Sell ${money(G.sellValue(i))}</button>` : '<span></span>'}
      ${canAct && s.phase === 'manage' && lv < G.RULES.maxLevel ? `<button class="primary build" data-build="${i}" ${c.ok ? '' : 'disabled'} aria-label="Build on ${esc(sp.name)} for ${money(G.buildCost(i))}"><span class="kick">Build</span>${money(G.buildCost(i))}</button>` : '<span></span>'}
    </div>`;
  }
  if (!mine.length) h += '<p>No lots yet.</p>';
  h += `</div><p class="note">Cash: <b>${money(s.players[p].cash)}</b>${s.players[p].debt ? ` · owes the bank ${money(s.players[p].debt)}` : ''}</p>`;
  const body = openSheet(h);
  if (at) {
    $('sheet').scrollTop = at.scroll;
    const row = body.querySelector(`[data-lot="${at.lot}"]`);
    const b = row?.querySelector(`[data-${at.focus}]:not(:disabled)`);
    if (row && !b) row.tabIndex = -1;
    (b || row)?.focus({ preventScroll: true });
  }
  const again = (lot, focus) => ({ lot, focus, scroll: $('sheet').scrollTop });
  body.querySelectorAll('[data-build]').forEach(b => b.addEventListener('click', async () => {
    const i = +b.dataset.build, at = again(i, 'build');
    closeSheet(); await doBuild(i); showLots(at);
  }));
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
      const at = again(i, 'sell');
      closeSheet(); await doSell(i); showLots(at);
    });
  });
}

// A player's sheet, from a tap on their card: their piece and name, a townsperson's line, their cash, loan and detours,
// and their lots with what each rents for, so a rival's holdings can be read without scanning the board. The person
// whose turn it is gets Your lots instead, to build and sell. Like a space's sheet, it can be opened while the
// townsfolk play, and holds them up until it's closed; mid-move it shows the game as the screen does.
function showPlayer(p) {
  if (!s || p < 0 || (busy && isHumanTurn())) return;
  if (isHumanTurn() && p === s.turn) { showLots(); return; }
  const v = shown || s, pl = v.players[p], bot = BOTS[pl.bot];
  const mine = OWNABLE.filter(i => v.owner[i] === p);
  let h = `<div class="kicker">${p === v.turn && v.phase !== 'over' ? 'Playing now' : `On ${place(pl.pos)}`}</div>
    <h2 id="sheetTitle" class="who-head">${art.tokenSvg(pl.token, 34)}<span>${esc(pl.name)}</span></h2>${bot ? `<p class="line">${esc(bot.line)}</p>` : ''}
    <table class="facts"><tr><td>Cash</td><td>${money(pl.cash)}</td></tr>${pl.debt ? `<tr><td>Owes the bank</td><td>${money(pl.debt)}</td></tr>` : ''}
    <tr><td>Detours</td><td>${pl.detours ? `<span aria-hidden="true">${'◆'.repeat(pl.detours)} </span>${pl.detours}` : 'None'}</td></tr>
    <tr><td>Worth</td><td>${money(G.netWorth(v, p))}</td></tr></table>
    <h3>${mine.length ? `${mine.length} lot${mine.length === 1 ? '' : 's'}` : 'No lots yet'}</h3>`;
  if (mine.length) {
    h += '<div class="pick-list">';
    for (const i of mine) {
      const sp = SPACES[i], price = G.buyoutPrice(v, i);
      const what = sp.type === 'depot' ? 'Depot' : G.LEVEL_NAMES[v.level[i]];
      h += `<div class="pick" style="cursor:default">${sp.district ? swatch(sp.district) : '<span class="swatch" style="background:#7d6b5a"></span>'}<span>${esc(sp.name)}<small>${what}, rent ${money(G.rentFor(v, i))}</small>${price != null ? `<small class="warn">Can be made to sell for ${money(price)}</small>` : ''}</span><span></span></div>`;
    }
    h += '</div>';
  }
  openSheet(h);
}

// Ask the person whose turn it is to answer the game's question. On a phone the sheet covers the player cards, so each
// question says once what cash they have to answer it with (class "have").
function askDecision() {
  if (!isHumanTurn() || s.phase !== 'decide') return;
  const q = s.pending, p = s.turn, pl = G.current(s);
  const later = () => { note = 'Still to decide.'; render(); };
  const have = `You have ${money(pl.cash)}${pl.debt ? ` and owe the bank ${money(pl.debt)}` : ''}`;
  let h = '';
  switch (q.kind) {
    case 'buy': {
      const can = pl.cash >= q.price;
      h = lotFacts(q.at) + `<div class="buttons stick">
        <button class="primary" data-c="buy" ${can ? '' : 'disabled'}>Buy it for ${money(q.price)}</button>
        <p class="note have">${can ? `${have}; ${money(pl.cash - q.price)} left after.` : `${have}.`}</p>
        <button class="secondary" data-c="pass">Leave it</button></div>`;
      break;
    }
    case 'rent': {
      const short = Math.max(0, q.rent - pl.cash);
      const sp = SPACES[q.at];
      // The cash is said once: with how short you are, or first in the note on a forced sale it won't stretch to, or
      // else under the sheet's opening line (not in the answers, which on a phone held sideways have no room to spare).
      const grey = q.buyout != null && pl.cash < q.buyout;
      h = lotFacts(q.at, { under: short || grey ? '' : `<p class="note have">${have}.</p>` }) + '<div class="buttons stick">';
      h += `<button class="primary" data-c="pay">Pay ${who(q.owner)} ${money(q.rent)}</button>`;
      if (short) h += `<p class="note have">${have}, so you're ${money(short)} short. The bank lends the rest, and ${W.SAYS.interest}. Money coming in pays it off first.</p>`;
      if (q.buyout != null) {
        h += `<button class="secondary" data-c="buyout" ${grey ? 'disabled' : ''}>Make ${who(q.owner)} sell it to you: ${money(q.buyout)}</button>
          <p class="note">${grey && !short ? `<span class="have">${have}.</span> ` : ''}Nothing is built here and ${who(q.owner)} ${agree(q.owner, "don't", "doesn't")} own ${sp.type === 'depot' ? 'both depots' : `all of ${DISTRICT[sp.district].name}`}, so ${who(q.owner)} ${agree(q.owner, 'have', 'has')} to sell at ${G.RULES.buyout} times the land value. You pay no rent.</p>`;
      }
      h += '</div>';
      break;
    }
    case 'office': case 'estate': {
      const half = q.kind === 'estate';
      // Each row says what the lot would rent for, empty, once yours, and where its district stands; a lot that would
      // finish one of your districts (or give you both depots) comes first.
      const list = G.emptyLots(s).filter(i => !half || SPACES[i].type === 'lot').map(i => ({ i, ...W.forSale(s, i, p) }))
        .sort((a, b) => b.finishes - a.finishes);
      h = `<h2 id="sheetTitle">${half ? 'Estate sale' : 'Land Office'}</h2><p>${half ? 'Buy any empty lot at half price.' : 'Buy any empty lot or depot in town at its price.'}</p><p class="note have">${have}.</p><div class="pick-list">`;
      for (const { i, line } of list) {
        const price = half ? Math.round(G.landValue(s, i) / 2 / 5) * 5 : G.landValue(s, i);
        const d = SPACES[i].district;
        h += `<button class="pick" data-c="${i}" ${price > pl.cash ? 'disabled' : ''}>${d ? swatch(d) : '<span class="swatch" style="background:#7d6b5a"></span>'}<span>${esc(SPACES[i].name)}<small>${esc(line)}</small></span><span class="cost">${money(price)}</span></button>`;
      }
      h += `</div><div class="buttons stick"><button class="secondary" data-c="pass">Not today</button></div>`;
      break;
    }
    case 'yard': {
      h = `<h2 id="sheetTitle">Lumberyard</h2><p>Build one level on one of your lots at half price.</p><p class="note have">${have}.</p><div class="pick-list">`;
      for (const i of OWNABLE.filter(j => s.owner[j] === p && SPACES[j].type === 'lot')) {
        const c = G.canBuild(s, p, i, 0.5);
        h += `<button class="pick" data-c="${i}" ${c.ok ? '' : 'disabled'}>${swatch(SPACES[i].district)}<span>${esc(SPACES[i].name)}<small>${s.level[i] < G.RULES.maxLevel ? `${G.LEVEL_NAMES[s.level[i] + 1]}: rent ${money(G.rentFor(s, i))} → ${money(W.rentAfterBuild(s, i))}` : 'Built as tall as it goes'}${!c.ok && c.reason && s.level[i] < G.RULES.maxLevel ? ' · ' + esc(c.reason) : ''}</small></span><span class="cost">${c.cost != null ? money(c.cost) : ''}</span></button>`;
      }
      h += `</div><div class="buttons stick"><button class="secondary" data-c="pass">Not today</button></div>`;
      break;
    }
    case 'hall': {
      h = `<h2 id="sheetTitle">City Hall</h2><p>Rezone one district: ${W.SAYS.hall}, and its rents with it. Land counts toward what you're worth.</p><div class="pick-list">`;
      // A district already as high as land goes can still be picked (were every one there, the question would have no
      // answer); its row says rezoning it changes nothing.
      const { pct } = W;
      for (const d of DISTRICTS) {
        const mine = LOTS_IN[d.id].filter(i => s.owner[i] === p).length;
        const now = s.land[d.id], top = now >= G.RULES.landMax;
        const to = Math.min(G.RULES.landMax, Math.round((now + G.RULES.hall) * 1000) / 1000);
        h += `<button class="pick" data-c="${d.id}">${swatch(d.id)}<span>${d.name}<small>${top ? `Land at ${pct(now)}, as high as it goes` : `Land at ${pct(now)} → ${pct(to)}`}${mine ? ` · you own ${mine} of 3` : ''}</small></span><span class="cost">${top ? '' : '↑'}</span></button>`;
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

// The banner for a whole district (`d`, or none for both depots) come to be player p's, for `ms`. It says what owning
// all of it does, and returns its words for the log.
let bannerTimer = null;
function banner(p, d, ms) {
  const R = G.RULES, color = d ? DISTRICT[d].color : '#7d6b5a', el = $('banner');
  const head = `${Who(p)} ${agree(p, 'own', 'owns')} ${d ? `all of ${DISTRICT[d].name}` : 'both depots'}`;
  const sub = d ? `Rents ${R.setEmpty === 2 ? 'double' : `go up ${R.setEmpty} times`} on its empty lots.`
    : `Rent is ${money(R.depotRent[2])} at each, and nobody can make ${who(p)} sell one.`;
  const [bg, fg] = art.readable(color);
  el.innerHTML = `<div class="ribbon" style="background:${bg};color:${fg}"><b>${head}</b><span>${sub}</span></div>`;
  el.hidden = false;
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
  return `${head}. ${sub}`;
}

// A headline over the middle of the board, for `ms`: the townsfolk's news, or a forced sale on a person's lot. The
// play waits for it a little while, not all of that time (none at all while a turn is hurried along).
let toastTimer = null;
const toastCard = (id, ms) => toast(esc(CARD[id].head), esc(CARD[id].body), ms);
function toast(head, body, ms) {
  const t = $('toast');
  t.innerHTML = `<span class="mast">The Boomtown Gazette</span><span class="head">${head}</span><span class="body">${body}</span>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  return nap(Math.min(ms, 1600 * pace()));
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
    <footer class="jd-foot"><a href="https://junkdrawer.works/"${LINK_TARGET}>Part of junkdrawer.works</a> <span aria-hidden="true">·</span> <a href="https://junkdrawer.works/privacy.html"${LINK_TARGET}>Privacy</a></footer>`);
  // On the menu's own buttons, which go with the menu: the sheet's body stays, and a listener on it would stay too,
  // one more each time the menu opens, so a tap on Sound would toggle it once for every opening.
  body.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'back') closeSheet();
    if (a === 'rules') showRules();
    if (a === 'sound') { prefs.sound = !soundOn(); setSound(prefs.sound); store.set(PREFS, prefs); b.textContent = `Sound: ${prefs.sound ? 'on' : 'off'}`; b.setAttribute('aria-pressed', prefs.sound); }
    if (a === 'speed') { prefs.speed = prefs.speed === 'fast' ? 'normal' : 'fast'; store.set(PREFS, prefs); b.textContent = `Pace: ${prefs.speed === 'fast' ? 'fast' : 'easy'}`; }
    if (a === 'leave') showTitle();
  }));
});

$('logBtn').addEventListener('click', () => {
  if (!s) return;
  openSheet(`<h2 id="sheetTitle">What happened</h2><ol class="log in-sheet">${logSheetHtml()}</ol>`);
});

function showRules() {
  openSheet(W.rulesHtml());
}

function showRecords() {
  const names = Object.fromEntries(Object.entries(BOTS).map(([id, b]) => [id, b.name]));
  openSheet(`${W.recordsHtml(store.get(RECORDS, {}), names)}
    <p class="note">${store.works() ? 'Kept on this device only.' : "Not kept here: this browser isn't saving anything."}</p>`);
}

// ---------- Founders' Day ----------
// The tune, then the special edition: a fanfare when a person has won, something gentler when one of the townsfolk has.
function celebrate() {
  if (s.players[G.standings(s)[0].p].kind === 'human') sfx.end(); else sfx.gentle();
  finish();
}
function finish() {
  const st = G.standings(s);
  // Records, once per game.
  if (!s.recorded && s.players.some(p => p.kind === 'human')) {
    const d = new Date(), date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    store.set(RECORDS, W.addGame(store.get(RECORDS, {}), s, st, date));
  }
  s.recorded = true;
  save();
  const head = `${Who(st[0].p)} ${agree(st[0].p, 'are', 'is')} the richest in Boomtown`;
  const [story, fact] = W.foundersDay(s, st);
  // Back to the board, by Look at the town or by closing the sheet any other way (✕, Escape, a tap outside it): the
  // line says who won, with a way back to the results, since the game has no more turns to offer.
  const toTown = () => {
    note = `${head}. <button class="link" id="againLink">See the results</button>`;
    render();
    const again = $('againLink');
    if (again) { again.onclick = finish; again.focus({ preventScroll: true }); }
  };
  const rows = st.map(x => `<li>${art.tokenSvg(s.players[x.p].token, 28)}<span class="nm">${nm(x.p)}<small>${x.cash < 0 ? `owes ${money(-x.cash)}` : `${money(x.cash)} cash`} · ${money(x.land)} land · ${money(x.buildings)} buildings</small></span><span class="w">${money(x.worth)}</span></li>`).join('');
  const body = openSheet(`<div class="gazette"><div class="mast">The Boomtown Gazette</div>
      <div class="dateline"><span>Founders' Day</span><span>Special edition</span></div>
      <div class="head" id="sheetTitle">${head}</div><div class="body">${esc(story)}</div>${fact ? `<div class="fact">${esc(fact)}</div>` : ''}</div>
    <ol class="standings">${rows}</ol>
    <h3>Worth, round by round</h3>${chart()}
    <div class="buttons"><button class="primary" data-a="again">Play again</button>${canShare() ? '<button class="secondary" data-a="share">Share the Gazette</button><p class="note shared" role="status" hidden></p>' : ''}<button class="secondary" data-a="title">Change players</button><button class="ghost" data-a="board">Look at the town</button></div>`, { closable: true, onClose: toTown });
  body.querySelector('[data-a="share"]')?.addEventListener('click', () => share(W.shareText(s, st), body.querySelector('.shared')));
  body.querySelector('[data-a="again"]').addEventListener('click', () => {
    // Who goes first moves one seat round the table each game, so the same player doesn't always start, with the
    // least cash. Everyone keeps their piece.
    const seats = s.players.map(p => ({ name: p.name, kind: p.kind, bot: p.bot, token: p.token }));
    seats.push(seats.shift());
    startGame(G.newGame({ seats, rounds: s.rounds }), false, true);
  });
  body.querySelector('[data-a="title"]').addEventListener('click', () => { store.del(KEY); showTitle(); });
  body.querySelector('[data-a="board"]').addEventListener('click', () => { closeSheet(); toTown(); });
}

// Share the Gazette: through the phone's share sheet where there is one, or else copied, to paste. Where neither
// works, Founders' Day doesn't offer it.
const canShare = () => !!(navigator.share || navigator.clipboard?.writeText);
async function share(text, said) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } // dismissed: nothing to say
  }
  try { await navigator.clipboard.writeText(text); said.textContent = 'Copied. Paste it wherever you like.'; } catch { said.textContent = "This browser won't let the page copy it."; }
  said.hidden = false;
}

function chart() {
  const W = 440, H = 180, pad = 46;
  const all = s.players.flatMap(p => p.history);
  const max = Math.max(...all, 1), min = Math.min(0, ...all), n = Math.max(...s.players.map(p => p.history.length)) - 1 || 1;
  // Each line ends in its player's name, in their colour (a shade darker where it needs to be to read on the paper),
  // so there's no key to look up. Names that would sit on top of each other are moved apart.
  const names = s.players.map(p => (p.name.length > 10 ? `${p.name.slice(0, 9)}…` : p.name));
  const right = W - 8 - Math.min(90, Math.max(...names.map(t => t.length)) * 7.4 + 8);
  const x = k => pad + (k / n) * (right - pad), y = v => H - 18 - ((v - min) / (max - min)) * (H - 30);
  let g = `<line x1="${pad}" y1="${y(0)}" x2="${right}" y2="${y(0)}" stroke="#0003"/>`;
  g += `<text x="${pad - 4}" y="${y(max) + 4}" text-anchor="end">${money(Math.round(max / 100) * 100)}</text><text x="${pad - 4}" y="${y(0) + 4}" text-anchor="end">$0</text>`;
  g += `<text x="${pad}" y="${H - 2}">Start</text><text x="${right}" y="${H - 2}" text-anchor="end">Round ${n}</text>`;
  // Read out, the lines come down to where each player ended, richest first.
  const ended = G.standings(s).map((x, k) => `${esc(s.players[x.p].name)}${k ? '' : ' ended'} on ${money(x.worth)}`).join(', ');
  s.players.forEach((p, q) => {
    g += `<polyline fill="none" stroke="${colorOf(q)}" stroke-width="3" stroke-linejoin="round" points="${p.history.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
  });
  const ends = s.players.map((p, q) => ({ q, y: y(p.history[p.history.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 17);
  const below = ends[ends.length - 1].y - (H - 22);
  if (below > 0) ends.forEach(e => { e.y -= below; });
  for (const e of ends) g += `<text class="who" x="${right + 6}" y="${(e.y + 4.5).toFixed(1)}" style="fill:${art.onPaper(colorOf(e.q))}">${esc(names[e.q])}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Each player's worth, round by round. ${ended}.">${g}</svg>`;
}

// ---------- fitting the board to the screen ----------
// On a wide screen the board is square, beside the players. On a phone held upright it goes the width of the screen
// and stands taller than it is wide, with the players in a row underneath, so the spaces down the sides and the middle
// of the board get more room: as tall as the screen leaves room for, from 1,140 board units (the least that keeps the
// side spaces' full-size drawings) to 1,400. Where even 1,140 won't fit the width, the board is narrower instead.
// The board leaves room for the header above it, and below it for the players' cards and two lines of What happened
// (the newest, which a cut-off log would hide): measured once the play screen shows (startGame fits again), and before
// that as a row of cards would need. The log then takes what's left, so no band of empty felt is left under it.
const LOG_LOW = 44, LOG_HIGH = 92; // the log box's least height on a phone, and its height where the page scrolls, in px
const TALL_MIN = 1140, TALL_MAX = 1400; // a phone's board height, in board units (it's 900 across)
const SIDE_MIN = 230; // the least width beside the board for the players and the log on a phone held sideways, in px
function fit() {
  const vw = innerWidth, vh = innerHeight, root = document.documentElement.style;
  const top = document.querySelector('.top').offsetHeight || 52, cards = $('players').offsetHeight || 62;
  const pad = parseFloat(getComputedStyle($('app')).paddingBottom) || 0;
  const twoLines = Math.ceil(2 * 13 * 1.4 + 2 + 16); // two log lines, the gap between them and the log's padding
  const reserve = top + 10 + 10 + cards + 8 + twoLines + pad;
  let w, H;
  const sideways = vw > vh && vh <= 520;
  if (sideways) {
    // Held sideways (see the css for the same test): square, as tall as the screen inside its edges, with room beside it
    // for the players and the log.
    const cs = getComputedStyle($('app')), px = k => parseFloat(cs[k]) || 0;
    H = 900;
    w = Math.min(vh - px('paddingTop') - px('paddingBottom'), vw - px('paddingLeft') - px('paddingRight') - 12 - SIDE_MIN);
  } else if (vw >= 900) { H = 900; w = Math.min(vh - 70, vw - 400, 860); }
  else if (vh / vw > 1.45) {
    // A phone held upright: the full width (up to 640 px), and the height the screen has room for.
    const room = vh - reserve;
    w = Math.min(vw - 16, 640);
    H = Math.max(TALL_MIN, Math.min(TALL_MAX, Math.floor(room * 900 / w / 6) * 6)); // a whole number of units per side space
    w = Math.min(w, room * 900 / H);
  } else {
    // A tablet held upright goes as wide as leaves room below for the players.
    H = 900;
    w = Math.min(vw - 16, vh - reserve, vw >= 700 ? Infinity : 640);
  }
  w = Math.max(260, Math.floor(w));
  const h = Math.round(w * H / 900);
  // Where even two lines can't fit, the page scrolls anyway, and the log keeps its height. (Held sideways, the log
  // takes the height beside the board instead: see the css.)
  const left = vh - (reserve - twoLines) - h;
  root.setProperty('--logmax', (left >= LOG_LOW ? Math.floor(left) : LOG_HIGH) + 'px');
  root.setProperty('--bw', w + 'px');
  root.setProperty('--bh', h + 'px');
  root.setProperty('--ctop', (150 / H * 100) + '%');
  root.setProperty('--cheight', ((H - 300) / H * 100) + '%');
  $('center').classList.toggle('snug', w < 360 || sideways); // a small phone's board, or a square one held sideways: see .center.snug
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
window.boomtown = { get state() { return s; }, get busy() { return busy; }, G, art, start: startGame, render };
showTitle(false);

// The rules of Boomtown, with no DOM. A game is one plain object (saved as JSON); every action changes it in place
// and returns a list of events for the screen to show. Randomness comes from the game's own seeded generator, so a
// saved game carries on exactly, and the tests and simulator are repeatable.

import { SPACES, DISTRICTS, DISTRICT, N, LOTS_IN, DEPOTS, OWNABLE } from './board.js';
import { CARDS, CARD } from './cards.js';

export const RULES = {
  startCash: 1000,
  seatBonus: 50,          // each later seat starts with this much more, for going after the others
  salary: 150,
  landBonus: 100,         // extra for landing on Payday exactly
  rent: [0.12, 0.5, 1.25, 2.5], // rent as a share of land value, by building level
  street: 0.3,           // rent bonus for each other built-up lot in the same district
  setEmpty: 2,            // rent multiplier on an empty lot whose owner has the whole district
  setBuilt: 1.5,         // ...and on a built one
  rise: 0.08,             // land value gained by a district for each building level added in it
  hall: 0.2,              // City Hall's rezoning
  buyout: 1.5,              // a forced sale costs this many times the land value
  sellBack: 0.5,          // selling a building level returns this share of what it cost
  interest: 0.1,          // charged on a loan each time you pass Payday
  depotRent: [0, 40, 100],
  taxPerLevel: 20, taxMin: 40,
  kittyStart: 50,
  landMin: 0.5, landMax: 3,
  maxLevel: 3,
  detours: 2,             // detour tokens each player starts with: move by one die instead of both
  detourMax: 2,           // the most anyone can hold; passing Payday gives one back
};

export const LEVEL_NAMES = ['Empty lot', 'House', 'Shop', 'Block'];
// Rounds in a game, by length and number of players: fewer players get more rounds, so the town still fills up.
export const ROUNDS = {
  short: { 2: 18, 3: 14, 4: 12 },
  standard: { 2: 30, 3: 24, 4: 20 },
  long: { 2: 40, 3: 32, 4: 28 },
};

// ---- random numbers (mulberry32), state kept in the game ----
function rand(s) {
  let t = (s.rng = (s.rng + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const die = s => 1 + Math.floor(rand(s) * 6);
function shuffle(s, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const round5 = x => Math.round(x / 5) * 5;

// ---- a new game ----
// seats: [{ name, kind: 'human' | 'bot', bot?: 'mabel' | ..., token: 0..3 }]
export function newGame({ seats, rounds = ROUNDS.standard[seats.length], seed = (Math.random() * 2 ** 32) >>> 0 }) {
  const s = {
    v: 1, seed, rng: seed | 0, rounds, round: 1, turn: 0, phase: 'roll',
    players: seats.map((seat, k) => ({
      name: seat.name, kind: seat.kind, bot: seat.bot || null, token: seat.token,
      pos: 0, cash: RULES.startCash + RULES.seatBonus * k, debt: 0, detours: RULES.detours, history: [],
    })),
    owner: Object.fromEntries(OWNABLE.map(i => [i, -1])),
    level: Object.fromEntries(OWNABLE.map(i => [i, 0])),
    land: Object.fromEntries(DISTRICTS.map(d => [d.id, 1])),
    kitty: RULES.kittyStart,
    deck: [], dice: null, pending: null, built: [], log: [],
  };
  s.deck = shuffle(s, CARDS.map(c => c.id));
  s.players.forEach((p, i) => p.history.push(netWorth(s, i)));
  return s;
}

// ---- values ----
export const current = s => s.players[s.turn];

export function landValue(s, i) {
  const sp = SPACES[i];
  if (sp.type === 'depot') return sp.price;
  return round5(sp.price * s.land[sp.district]);
}
export const buildCost = i => DISTRICT[SPACES[i].district].build;

export const ownsDistrict = (s, p, d) => LOTS_IN[d].every(i => s.owner[i] === p);

export function rentFor(s, i, level = s.level[i]) {
  const sp = SPACES[i], o = s.owner[i];
  if (o < 0) return 0;
  if (sp.type === 'depot') return RULES.depotRent[DEPOTS.filter(d => s.owner[d] === o).length];
  const others = LOTS_IN[sp.district].filter(j => j !== i && s.level[j] > 0).length;
  const set = ownsDistrict(s, o, sp.district) ? (level ? RULES.setBuilt : RULES.setEmpty) : 1;
  return round5(landValue(s, i) * RULES.rent[level] * (1 + RULES.street * others) * set);
}

export function netWorth(s, p) {
  const pl = s.players[p];
  let w = pl.cash - pl.debt;
  for (const i of OWNABLE) if (s.owner[i] === p) w += landValue(s, i) + (SPACES[i].type === 'lot' ? s.level[i] * buildCost(i) : 0);
  return w;
}
export function holdings(s, p) {
  let land = 0, buildings = 0, levels = 0;
  for (const i of OWNABLE) if (s.owner[i] === p) {
    land += landValue(s, i);
    if (SPACES[i].type === 'lot') { buildings += s.level[i] * buildCost(i); levels += s.level[i]; }
  }
  return { land, buildings, levels };
}

// Can player p build one level on space i now? { ok, cost, reason }
export function canBuild(s, p, i, discount = 1) {
  const sp = SPACES[i], pl = s.players[p];
  if (sp.type !== 'lot') return { ok: false, reason: 'Nothing can be built here.' };
  if (s.owner[i] !== p) return { ok: false, reason: 'Not yours.' };
  if (s.level[i] >= RULES.maxLevel) return { ok: false, reason: 'Built as tall as it goes.' };
  if (s.level[i] === RULES.maxLevel - 1 && !ownsDistrict(s, p, sp.district)) {
    return { ok: false, reason: `A block needs all of ${DISTRICT[sp.district].name}.` };
  }
  const cost = Math.round(buildCost(i) * discount);
  if (pl.cash < cost) return { ok: false, cost, reason: `Costs $${cost}.` };
  return { ok: true, cost };
}

// Can the player on space i force its owner to sell it?
export function buyoutPrice(s, i) {
  const o = s.owner[i];
  if (o < 0 || s.level[i] > 0) return null;
  const sp = SPACES[i];
  if (sp.type === 'depot' ? DEPOTS.every(d => s.owner[d] === o) : ownsDistrict(s, o, sp.district)) return null;
  return round5(landValue(s, i) * RULES.buyout);
}

// ---- money ----
// Pay from a player to a player, the bank or the kitty. Short of cash, the rest is a loan from the bank.
function pay(s, ev, from, to, amount, why) {
  if (amount <= 0) return;
  const pl = s.players[from];
  const paid = Math.min(pl.cash, amount);
  pl.cash -= paid;
  if (paid < amount) { pl.debt += amount - paid; ev.push({ t: 'loan', p: from, amount: amount - paid }); }
  ev.push({ t: 'pay', from, to, amount, why });
  if (to === 'kitty') s.kitty += amount;
  else if (typeof to === 'number') receive(s, ev, to, amount);
}
// Money coming in pays off a loan first.
function receive(s, ev, p, amount) {
  const pl = s.players[p];
  const repay = Math.min(pl.debt, amount);
  if (repay) { pl.debt -= repay; ev.push({ t: 'repaid', p, amount: repay }); }
  pl.cash += amount - repay;
}
function collect(s, ev, p, amount, why) {
  ev.push({ t: 'collect', p, amount, why });
  receive(s, ev, p, amount);
}

function shiftLand(s, ev, d, by) {
  const from = s.land[d];
  s.land[d] = Math.min(RULES.landMax, Math.max(RULES.landMin, Math.round((from + by) * 1000) / 1000));
  if (s.land[d] !== from) ev.push({ t: 'land', d, from, to: s.land[d] });
}

// ---- a turn ----
export function roll(s) {
  if (s.phase !== 'roll') throw new Error('not time to roll');
  s.dice = [die(s), die(s)];
  s.phase = 'move';
  return [{ t: 'roll', p: s.turn, dice: [...s.dice] }];
}

// The moves the dice allow: both together, or (for a detour token) either die alone.
// Each option: { steps, to, detour, label }. Detours are listed even with no token left, marked usable: false.
export function moveOptions(s) {
  const [a, b] = s.dice, pl = current(s), pos = pl.pos;
  const opts = [{ steps: a + b, detour: false }];
  for (const n of a === b ? [a] : [Math.min(a, b), Math.max(a, b)]) opts.push({ steps: n, detour: true });
  return opts.map(o => ({ ...o, to: (pos + o.steps) % N, usable: !o.detour || pl.detours > 0 }));
}

export function move(s, steps, detour = false) {
  if (s.phase !== 'move') throw new Error('not time to move');
  const o = moveOptions(s).find(x => x.steps === steps && x.detour === detour);
  if (!o || !o.usable) throw new Error('not a move the dice allow');
  const ev = [];
  if (detour) { current(s).detours--; ev.push({ t: 'detour', p: s.turn, left: current(s).detours }); }
  advance(s, ev, steps);
  return ev;
}

function advance(s, ev, steps) {
  const p = s.turn, pl = s.players[p], path = [];
  for (let k = 1; k <= steps; k++) path.push((pl.pos + k) % N);
  ev.push({ t: 'move', p, from: pl.pos, path });
  pl.pos = path[path.length - 1];
  const passed = path.indexOf(0);
  if (passed >= 0) payday(s, ev, p, passed === path.length - 1);
  arrive(s, ev);
}

function payday(s, ev, p, landed) {
  const pl = s.players[p];
  if (pl.debt) {
    const interest = Math.max(5, Math.ceil(pl.debt * RULES.interest / 5) * 5);
    pl.debt += interest;
    ev.push({ t: 'interest', p, amount: interest });
  }
  collect(s, ev, p, RULES.salary + (landed ? RULES.landBonus : 0), landed ? 'Payday, landed on it' : 'Payday');
  if (pl.detours < RULES.detourMax) pl.detours++;
}

// Work out what the space the current player stands on asks of them.
function arrive(s, ev) {
  const p = s.turn, pl = s.players[p], i = pl.pos, sp = SPACES[i];
  s.pending = null;
  switch (sp.type) {
    case 'lot': case 'depot': {
      const o = s.owner[i];
      if (o < 0) s.pending = { kind: 'buy', at: i, price: landValue(s, i) };
      else if (o !== p) s.pending = { kind: 'rent', at: i, owner: o, rent: rentFor(s, i), buyout: buyoutPrice(s, i) };
      break;
    }
    case 'gazette': drawCard(s, ev); break;
    case 'office': if (emptyLots(s).length) s.pending = { kind: 'office' }; break;
    case 'yard': if (OWNABLE.some(j => canBuild(s, p, j, 0.5).ok)) s.pending = { kind: 'yard' }; break;
    case 'square':
      if (s.kitty > 0) { const k = s.kitty; s.kitty = 0; collect(s, ev, p, k, 'the kitty'); ev.push({ t: 'kitty', p, amount: k }); }
      break;
    case 'hall': s.pending = { kind: 'hall' }; break;
    case 'tax': {
      const { levels } = holdings(s, p);
      pay(s, ev, p, 'kitty', Math.max(RULES.taxMin, levels * RULES.taxPerLevel), 'the assessor');
      break;
    }
  }
  s.phase = s.pending ? 'decide' : 'manage';
}

export const emptyLots = s => OWNABLE.filter(i => s.owner[i] < 0);

function drawCard(s, ev) {
  if (!s.deck.length) s.deck = shuffle(s, CARDS.map(c => c.id));
  const id = s.deck.shift();
  ev.push({ t: 'card', p: s.turn, card: id });
  applyCard(s, ev, CARD[id]);
}

function applyCard(s, ev, card) {
  const p = s.turn, d = card.do;
  if (d.land) for (const [k, v] of Object.entries(d.land)) shiftLand(s, ev, k, v);
  if (d.landBuilt) for (const dist of DISTRICTS) if (LOTS_IN[dist.id].some(i => s.level[i] > 0)) shiftLand(s, ev, dist.id, d.landBuilt);
  if (d.landAll) for (const dist of DISTRICTS) shiftLand(s, ev, dist.id, d.landAll);
  if (d.everyone) s.players.forEach((_, q) => collect(s, ev, q, d.everyone, 'the county fair'));
  if (d.collect) collect(s, ev, p, d.collect, 'an inheritance');
  if (d.perLevel) pay(s, ev, p, 'kitty', holdings(s, p).levels * d.perLevel, 'burst pipes');
  if (d.fine) pay(s, ev, p, 'kitty', d.fine, 'a fine');
  if (d.toDepot || d.toPayday) {
    const pos = s.players[p].pos;
    let target = 0;
    if (d.toDepot) target = DEPOTS.map(x => ({ x, k: (x - pos + N) % N || N })).sort((a, b) => a.k - b.k)[0].x;
    const steps = (target - pos + N) % N || N;
    advance(s, ev, steps);
    return; // advance() has already worked out the new space
  }
  if (d.estate && emptyLots(s).some(i => SPACES[i].type === 'lot')) s.pending = { kind: 'estate' };
  s.phase = s.pending ? 'decide' : 'manage';
}

// Answer the pending question. choice depends on the kind:
//   buy: 'buy' | 'pass'        rent: 'pay' | 'buyout'      office, estate: a space index | 'pass'
//   yard: a space index | 'pass'                           hall: a district id
export function decide(s, choice) {
  if (s.phase !== 'decide' || !s.pending) throw new Error('nothing to decide');
  const p = s.turn, pl = s.players[p], q = s.pending, ev = [];
  const buyLot = (i, price) => {
    if (pl.cash < price) throw new Error('not enough cash');
    pay(s, ev, p, 'bank', price, SPACES[i].name);
    s.owner[i] = p;
    ev.push({ t: 'buy', p, at: i, price });
  };
  switch (q.kind) {
    case 'buy': if (choice === 'buy') buyLot(q.at, q.price); else if (choice !== 'pass') throw new Error('buy or pass'); break;
    case 'rent':
      if (choice === 'buyout') {
        if (q.buyout == null || pl.cash < q.buyout) throw new Error('cannot buy this one out');
        pay(s, ev, p, q.owner, q.buyout, `buying ${SPACES[q.at].name}`);
        s.owner[q.at] = p;
        ev.push({ t: 'buyout', p, from: q.owner, at: q.at, price: q.buyout });
      } else if (choice === 'pay') pay(s, ev, p, q.owner, q.rent, `rent on ${SPACES[q.at].name}`);
      else throw new Error('pay or buyout');
      break;
    case 'office': case 'estate':
      if (choice !== 'pass') {
        if (s.owner[choice] !== -1 || (q.kind === 'estate' && SPACES[choice].type !== 'lot')) throw new Error('not for sale');
        buyLot(choice, q.kind === 'estate' ? round5(landValue(s, choice) / 2) : landValue(s, choice));
      }
      break;
    case 'yard':
      if (choice !== 'pass') {
        const c = canBuild(s, p, choice, 0.5);
        if (!c.ok) throw new Error(c.reason);
        doBuild(s, ev, choice, c.cost);
      }
      break;
    case 'hall':
      if (!DISTRICT[choice]) throw new Error('pick a district');
      shiftLand(s, ev, choice, RULES.hall);
      ev.push({ t: 'rezone', p, d: choice });
      break;
  }
  s.pending = null;
  s.phase = 'manage';
  return ev;
}

function doBuild(s, ev, i, cost) {
  const p = s.turn;
  pay(s, ev, p, 'bank', cost, 'building');
  s.level[i]++;
  shiftLand(s, ev, SPACES[i].district, RULES.rise);
  ev.push({ t: 'build', p, at: i, level: s.level[i], cost });
}

// After the space is dealt with, the current player can build and sell, then end their turn.
export function build(s, i) {
  if (s.phase !== 'manage') throw new Error('not time to build');
  const c = canBuild(s, s.turn, i);
  if (!c.ok) throw new Error(c.reason);
  const ev = [];
  doBuild(s, ev, i, c.cost);
  return ev;
}

export function canSell(s, p, i) {
  // Any level can come down. (A block that later loses its whole district still stands; it just can't be rebuilt.)
  return SPACES[i].type === 'lot' && s.owner[i] === p && s.level[i] > 0;
}
export const sellValue = i => Math.round(buildCost(i) * RULES.sellBack);

export function sell(s, i) {
  if (s.phase !== 'manage' && s.phase !== 'roll') throw new Error('not time to sell');
  if (!canSell(s, s.turn, i)) throw new Error('nothing to sell');
  const ev = [], p = s.turn, refund = sellValue(i);
  s.level[i]--;
  shiftLand(s, ev, SPACES[i].district, -RULES.rise);
  collect(s, ev, p, refund, 'selling up');
  ev.push({ t: 'sell', p, at: i, level: s.level[i], refund });
  return ev;
}

export function endTurn(s) {
  if (s.phase !== 'manage') throw new Error('not time to end the turn');
  const ev = [];
  s.dice = null;
  s.turn = (s.turn + 1) % s.players.length;
  if (s.turn === 0) {
    s.players.forEach((pl, q) => pl.history.push(netWorth(s, q)));
    if (s.round >= s.rounds) { s.phase = 'over'; ev.push({ t: 'over' }); return ev; }
    s.round++;
  }
  s.phase = 'roll';
  ev.push({ t: 'turn', p: s.turn, round: s.round });
  return ev;
}

// Final standings, richest first. Ties go to more cash in hand.
export function standings(s) {
  return s.players.map((pl, p) => ({ p, worth: netWorth(s, p), cash: pl.cash - pl.debt, ...holdings(s, p) }))
    .sort((a, b) => b.worth - a.worth || b.cash - a.cash);
}

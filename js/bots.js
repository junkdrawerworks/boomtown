// The townsfolk you play against. Each one answers the same questions a person does, through the same rules, with
// its own habits: how much cash it keeps back, how keen it is on land, building and forcing sales.

import { SPACES, DISTRICT, N, LOTS_IN, OWNABLE, DEPOTS } from './board.js';
import {
  RULES, current, moveOptions, landValue, rentFor, canBuild, ownsDistrict, holdings, emptyLots,
  roll, move, decide, build, sell, endTurn, sellValue, buyoutPrice,
} from './game.js';

export const BOTS = {
  mabel: { name: 'Mabel', line: 'Keeps a cushion and never overreaches.', reserve: 300, buy: 0.9, build: 0.8, buyout: 0.6, tall: 0.9 },
  rusty: { name: 'Rusty', line: 'Buys anything with a fence round it.', reserve: 60, buy: 1.4, build: 1.0, buyout: 1.0, tall: 0.8 },
  dot: { name: 'Dot', line: 'Wants whole streets, and will force a sale to get one.', reserve: 150, buy: 1.0, build: 1.0, buyout: 1.6, tall: 1.0, streets: true },
  gus: { name: 'Gus', line: 'Builds tall and builds early.', reserve: 120, buy: 1.0, build: 1.4, buyout: 0.8, tall: 1.4 },
};

const me = s => BOTS[current(s).bot] || BOTS.mabel;

// How much a lot is worth to player p beyond its price: more if p already owns some of its district,
// most if it would finish the district.
function want(s, p, i, extra = 0) {
  const sp = SPACES[i];
  if (sp.type === 'depot') {
    const mine = DEPOTS.filter(d => s.owner[d] === p).length;
    return 0.9 + 0.6 * mine;
  }
  const lots = LOTS_IN[sp.district];
  const mine = lots.filter(j => s.owner[j] === p).length + extra;
  const rivals = lots.filter(j => s.owner[j] >= 0 && s.owner[j] !== p).length;
  let w = 1 + 0.4 * mine;
  if (mine === lots.length - 1 && rivals === 0) w += 0.8; // finishes it
  if (rivals) w -= 0.2 * rivals;
  // Land is worth more early, when there's time to build on it and collect.
  w *= 0.6 + 0.6 * (1 - s.round / s.rounds);
  return w;
}

// What owning space i would do for the current player's street: 'whole' if it finishes the district (or the pair of
// depots), 'short' if it leaves them one lot short with that lot still for sale, otherwise null.
function streetAfter(s, i) {
  const p = s.turn, sp = SPACES[i];
  const lots = sp.type === 'depot' ? DEPOTS : LOTS_IN[sp.district];
  const mineAfter = lots.filter(j => j === i || s.owner[j] === p).length;
  if (mineAfter === lots.length) return 'whole';
  if (mineAfter === lots.length - 1 && lots.every(j => j === i || s.owner[j] === p || s.owner[j] < 0)) return 'short';
  return null;
}

// What forcing the sale of space i is worth to the current player, in dollars: the land itself, the rent it saves,
// and a good deal more if it finishes a district (or the pair of depots).
function buyoutWorth(s, i) {
  const value = landValue(s, i), street = streetAfter(s, i);
  const late = 1 - s.round / s.rounds;
  let worth = value + rentFor(s, i);
  if (street === 'whole') worth += value * (SPACES[i].type === 'depot' ? 1 : 2.5) * (0.4 + late);
  else if (street === 'short') worth += value * 0.6 * late;
  return worth;
}

// A townsperson who wants whole streets (Dot) forces a sale only to get one: when it finishes a district, or leaves
// her one lot short with that lot still for sale and at least three rounds left to buy it.
const STREET_ROUNDS = 3;
function forStreet(s, i) {
  if (!me(s).streets) return true;
  const street = streetAfter(s, i);
  return street === 'whole' || (street === 'short' && s.rounds - s.round >= STREET_ROUNDS);
}

// The cash this bot wants to hold back, scaled to the rents around the board.
function reserve(s) {
  const b = me(s);
  const p = s.turn;
  const worst = Math.max(0, ...OWNABLE.filter(i => s.owner[i] >= 0 && s.owner[i] !== p).map(i => rentFor(s, i)));
  const late = s.round > s.rounds - 2 ? 0 : 1; // in the last rounds, cash counts the same as anything
  return late * (b.reserve + 0.5 * worst);
}

// Would this bot buy lot i, at this price, holding this much cash? It keeps its cushion, unless it wants the lot
// badly. The same test answers the offer and scores the move there, so a bot never goes out of its way to a lot
// and then walks past it.
export function wouldBuy(s, i, cash = current(s).cash, price = landValue(s, i)) {
  if (price > cash) return false;
  const after = cash - price, w = want(s, s.turn, i) * me(s).buy;
  return after >= reserve(s) * (w > 1.6 ? 0.4 : 1) || (w > 1.2 && after > 40);
}

// Would this bot make the owner of lot i sell it? Only if it's worth the price to this bot, keeps some of its
// cushion, and isn't the final round: then a sale costs half as much again as the land adds to worth, and saves
// only one rent. Dot also wants it for a street (see forStreet).
export function wouldForce(s, i, cash = current(s).cash, price = buyoutPrice(s, i)) {
  if (price == null || price > cash || s.round >= s.rounds || !forStreet(s, i)) return false;
  return buyoutWorth(s, i) * me(s).buyout >= price && cash - price >= reserve(s) * 0.4;
}

// Score where each move would land, for choosing between the dice.
export function scoreSpace(s, to, steps) {
  const p = s.turn, pl = current(s), sp = SPACES[to], b = me(s);
  let v = 0, cash = pl.cash;
  const passes = pl.pos + steps >= N;
  if (passes) {
    const pay = RULES.salary + (to === 0 ? RULES.landBonus : 0);
    v += pay;
    // Payday's money goes to any loan first, interest and all.
    const debt = pl.debt ? pl.debt + Math.max(5, Math.ceil(pl.debt * RULES.interest / 5) * 5) : 0;
    cash += Math.max(0, pay - debt);
  }
  switch (sp.type) {
    case 'lot': case 'depot': {
      const o = s.owner[to];
      if (o < 0) {
        if (wouldBuy(s, to, cash)) v += landValue(s, to) * 0.4 * want(s, p, to) * b.buy;
      } else if (o === p) v += 5;
      else {
        const rent = rentFor(s, to);
        v -= rent;
        if (wouldForce(s, to, cash)) v += rent + buyoutWorth(s, to) * b.buyout - buyoutPrice(s, to);
      }
      break;
    }
    case 'gazette': v += 10; break;
    case 'office': if (emptyLots(s).length && pl.cash > 200) v += 40 * b.buy; break;
    case 'yard': if (OWNABLE.some(j => canBuild(s, p, j, 0.5).ok)) v += 50 * b.build; break;
    case 'square': v += s.kitty; break;
    case 'hall': v += 0.2 * holdings(s, p).land * (s.round < s.rounds ? 1 : 0.5); break;
    case 'tax': v -= Math.max(RULES.taxMin, holdings(s, p).levels * RULES.taxPerLevel); break;
  }
  return v;
}

// Both dice unless a detour is worth one of the few tokens.
export function chooseMove(s) {
  const opts = moveOptions(s).filter(o => o.usable).map(o => ({ o, v: scoreSpace(s, o.to, o.steps) }));
  const plain = opts.find(x => !x.o.detour);
  const cost = DETOUR_VALUE[current(s).detours] ?? 40;
  const best = opts.filter(x => x.o.detour).sort((a, b) => b.v - a.v)[0];
  return best && best.v - cost > plain.v ? best.o : plain.o;
}
// What a token is worth keeping, by how many are left.
const DETOUR_VALUE = [Infinity, 70, 45, 30];

// The best lot to buy from a list, or null. A bargain is taken whenever it can be paid for.
function bestToBuy(s, list, priceOf, bargain = false) {
  const p = s.turn, pl = current(s), b = me(s);
  let best = null, bestV = bargain ? -Infinity : 0;
  for (const i of list) {
    const price = priceOf(i);
    if (price > pl.cash) continue;
    const v = want(s, p, i) * b.buy - (reserve(s) - (pl.cash - price) > 0 ? 1 : 0);
    if (v > bestV) { bestV = v; best = i; }
  }
  return best;
}

export function chooseDecision(s) {
  const p = s.turn, pl = current(s), q = s.pending;
  switch (q.kind) {
    case 'buy': return wouldBuy(s, q.at, pl.cash, q.price) ? 'buy' : 'pass';
    case 'rent': return wouldForce(s, q.at, pl.cash, q.buyout ?? null) ? 'buyout' : 'pay';
    case 'office': return bestToBuy(s, emptyLots(s), i => landValue(s, i)) ?? 'pass';
    case 'estate': return bestToBuy(s, emptyLots(s).filter(i => SPACES[i].type === 'lot'), i => Math.round(landValue(s, i) / 10) * 5, true) ?? 'pass'; // half, to the $5, as decide() charges
    case 'yard': return bestBuild(s, 0.5, true) ?? 'pass';
    case 'hall': {
      // The district where this bot has the most riding on it: its own land there, less what the rise hands its
      // rivals, shared out among them.
      const rivals = Math.max(1, s.players.length - 1);
      let best = 'mill', bestV = -Infinity;
      for (const [d, lots] of Object.entries(LOTS_IN)) {
        const v = lots.reduce((t, i) => t + (s.owner[i] === p ? 1 : s.owner[i] >= 0 ? -1 / rivals : 0) * landValue(s, i), 0);
        if (v > bestV) { bestV = v; best = d; }
      }
      return best;
    }
  }
  return 'pass';
}

// The build with the best rent gained per dollar, if this bot is willing to spend on it. In the final round the
// cushion is gone (see reserve), and a building is still worth what it cost on Founders' Day and lifts the street.
function bestBuild(s, discount = 1, cheap = false) {
  const p = s.turn, pl = current(s), b = me(s);
  let best = null, bestV = 0;
  for (const i of OWNABLE) {
    const c = canBuild(s, p, i, discount);
    if (!c.ok) continue;
    if (!cheap && pl.cash - c.cost < reserve(s) / b.build) continue;
    const gain = rentFor(s, i, s.level[i] + 1) - rentFor(s, i);
    const tall = s.level[i] >= 1 ? b.tall : 1;
    const v = (gain / c.cost) * tall * (ownsDistrict(s, p, SPACES[i].district) ? 1.3 : 1);
    if (v > bestV) { bestV = v; best = i; }
  }
  return best;
}

// Sell buildings back to clear a big loan, cheapest first, keeping blocks to last. A sale returns half what the
// building cost and takes the street's land down with it, so smaller loans ride, and in the last three rounds
// nothing is sold: the interest left to come is less than the sale throws away.
const SELL_AT = 400, KEEP_ROUNDS = 3;
function raiseCash(s) {
  const p = s.turn, ev = [];
  if (s.round > s.rounds - KEEP_ROUNDS) return ev;
  while (current(s).debt >= SELL_AT) {
    const mine = OWNABLE.filter(i => s.owner[i] === p && s.level[i] > 0)
      .sort((a, b) => s.level[a] - s.level[b] || sellValue(a) - sellValue(b));
    if (!mine.length) break;
    ev.push(...sell(s, mine[0]));
  }
  return ev;
}

// Take one step of a bot's turn. Returns the events, or null if the game is over or it isn't a bot's turn.
export function botStep(s) {
  if (s.phase === 'over' || current(s).kind !== 'bot') return null;
  switch (s.phase) {
    case 'roll': return roll(s);
    case 'move': { const o = chooseMove(s); return move(s, o.steps, o.detour); }
    case 'decide': return decide(s, chooseDecision(s));
    case 'manage': {
      const ev = raiseCash(s);
      if (ev.length) return ev;
      const i = bestBuild(s);
      if (i != null) return build(s, i);
      return endTurn(s);
    }
  }
  return null;
}


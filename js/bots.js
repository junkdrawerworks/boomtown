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
  dot: { name: 'Dot', line: 'Wants whole streets, and will force a sale to get one.', reserve: 150, buy: 1.0, build: 1.0, buyout: 1.6, tall: 1.0 },
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

// What forcing the sale of space i is worth to the current player, in dollars: the land itself, the rent it saves,
// and a good deal more if it finishes a district (or the pair of depots).
function buyoutWorth(s, i) {
  const p = s.turn, sp = SPACES[i], value = landValue(s, i);
  const lots = sp.type === 'depot' ? DEPOTS : LOTS_IN[sp.district];
  const mineAfter = lots.filter(j => j === i || s.owner[j] === p).length;
  const late = 1 - s.round / s.rounds;
  let worth = value + rentFor(s, i);
  if (mineAfter === lots.length) worth += value * (sp.type === 'depot' ? 1 : 2.5) * (0.4 + late);
  else if (mineAfter === lots.length - 1 && lots.every(j => j === i || s.owner[j] === p || s.owner[j] < 0)) worth += value * 0.6 * late;
  return worth;
}

// The cash this bot wants to hold back, scaled to the rents around the board.
function reserve(s) {
  const b = me(s);
  const p = s.turn;
  const worst = Math.max(0, ...OWNABLE.filter(i => s.owner[i] >= 0 && s.owner[i] !== p).map(i => rentFor(s, i)));
  const late = s.round > s.rounds - 2 ? 0 : 1; // in the last rounds, cash counts the same as anything
  return late * (b.reserve + 0.5 * worst);
}

// Score where each move would land, for choosing between the dice.
function scoreSpace(s, to, steps) {
  const p = s.turn, pl = current(s), sp = SPACES[to], b = me(s);
  let v = 0;
  const passes = pl.pos + steps >= N;
  if (passes) v += RULES.salary + (to === 0 ? RULES.landBonus : 0);
  switch (sp.type) {
    case 'lot': case 'depot': {
      const o = s.owner[to];
      if (o < 0) {
        const price = landValue(s, to);
        if (pl.cash - price >= reserve(s) * 0.5) v += price * 0.4 * want(s, p, to) * b.buy;
      } else if (o === p) v += 5;
      else {
        const rent = rentFor(s, to);
        v -= rent;
        const bo = buyoutPrice(s, to);
        if (bo != null && pl.cash > bo && buyoutWorth(s, to) * b.buyout >= bo) v += rent + buyoutWorth(s, to) * b.buyout - bo;
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

// The best lot to buy from a list, or null.
function bestToBuy(s, list, priceOf) {
  const p = s.turn, pl = current(s), b = me(s);
  let best = null, bestV = 0;
  for (const i of list) {
    const price = priceOf(i);
    if (price > pl.cash) continue;
    const v = want(s, p, i) * b.buy - (reserve(s) - (pl.cash - price) > 0 ? 1 : 0);
    if (v > bestV) { bestV = v; best = i; }
  }
  return best;
}

export function chooseDecision(s) {
  const p = s.turn, pl = current(s), q = s.pending, b = me(s);
  switch (q.kind) {
    case 'buy': {
      if (q.price > pl.cash) return 'pass';
      const after = pl.cash - q.price;
      const w = want(s, p, q.at) * b.buy;
      return after >= reserve(s) * (w > 1.6 ? 0.4 : 1) || (w > 1.2 && after > 40) ? 'buy' : 'pass';
    }
    case 'rent': {
      if (q.buyout == null || q.buyout > pl.cash) return 'pay';
      return buyoutWorth(s, q.at) * b.buyout >= q.buyout && pl.cash - q.buyout >= reserve(s) * 0.4 ? 'buyout' : 'pay';
    }
    case 'office': return bestToBuy(s, emptyLots(s), i => landValue(s, i)) ?? 'pass';
    case 'estate': return bestToBuy(s, emptyLots(s).filter(i => SPACES[i].type === 'lot'), i => Math.round(landValue(s, i) / 2)) ?? 'pass';
    case 'yard': return bestBuild(s, 0.5, true) ?? 'pass';
    case 'hall': {
      // The district where this bot has the most riding on it.
      let best = 'mill', bestV = -1;
      for (const [d, lots] of Object.entries(LOTS_IN)) {
        const v = lots.filter(i => s.owner[i] === p).reduce((t, i) => t + landValue(s, i) + 1, 0);
        if (v > bestV) { bestV = v; best = d; }
      }
      return best;
    }
  }
  return 'pass';
}

// The build with the best rent gained per dollar, if this bot is willing to spend on it.
function bestBuild(s, discount = 1, cheap = false) {
  const p = s.turn, pl = current(s), b = me(s);
  if (s.round >= s.rounds) return null; // nobody will pay rent on it
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


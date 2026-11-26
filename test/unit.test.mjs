// The rules, without a browser:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
import { botStep, BOTS, chooseDecision, scoreSpace } from '../js/bots.js';
import { readFileSync } from 'node:fs';
import { SPACES, LOTS_IN, OWNABLE, N, DEPOTS, DISTRICTS, SPACE_HELP } from '../js/board.js';
import { CARDS } from '../js/cards.js';
import * as W from '../js/words.js';

const seats = (n = 2) => Array.from({ length: n }, (_, k) => ({ name: 'P' + k, kind: 'human', token: k }));
const at = name => SPACES.findIndex(s => s.name === name);
// Put the current player on a space by "rolling" the dice it takes to get there.
function goTo(s, target, detour = false) {
  const pos = G.current(s).pos;
  const steps = (target - pos + N) % N;
  s.dice = steps > 1 ? [1, steps - 1] : [1, 1];
  if (steps === 1) { s.dice = [1, 3]; detour = true; }
  s.phase = 'move';
  return G.move(s, steps, detour);
}

test('a new game: cash, a head start for later seats, nothing owned', () => {
  const s = G.newGame({ seats: seats(3), seed: 1 });
  assert.deepEqual(s.players.map(p => p.cash), [1000, 1050, 1100]);
  assert.ok(OWNABLE.every(i => s.owner[i] === -1 && s.level[i] === 0));
  assert.equal(s.rounds, G.ROUNDS.standard[3]);
  assert.equal(s.phase, 'roll');
  assert.equal(s.players[0].detours, G.RULES.detours);
});

test('the board: 28 spaces, six districts of three lots, two depots', () => {
  assert.equal(SPACES.length, 28);
  assert.equal(Object.values(LOTS_IN).flat().length, 18);
  assert.ok(Object.values(LOTS_IN).every(l => l.length === 3));
  assert.equal(DEPOTS.length, 2);
  assert.equal(SPACES[0].type, 'payday');
});

test('moves: both dice, or a detour by either one', () => {
  const s = G.newGame({ seats: seats(), seed: 2 });
  s.dice = [2, 5]; s.phase = 'move';
  assert.deepEqual(G.moveOptions(s).map(o => [o.steps, o.detour]), [[7, false], [2, true], [5, true]]);
  s.dice = [3, 3];
  assert.deepEqual(G.moveOptions(s).map(o => [o.steps, o.detour]), [[6, false], [3, true]]);
  s.players[0].detours = 0;
  assert.equal(G.moveOptions(s).find(o => o.detour).usable, false);
  assert.throws(() => G.move(s, 3, true));
  s.players[0].detours = 2;
  G.move(s, 3, true);
  assert.equal(s.players[0].detours, 1);
  assert.equal(s.players[0].pos, 3);
});

test('Payday: pay for passing, a bonus for landing, a detour back', () => {
  const s = G.newGame({ seats: seats(), seed: 3 });
  s.players[0].pos = 25; s.players[0].detours = 0;
  goTo(s, 2);
  assert.equal(s.players[0].cash, 1000 + G.RULES.salary - 0); // lands on Mill Row, for sale: nothing paid yet
  assert.equal(s.players[0].detours, 1);
  const t = G.newGame({ seats: seats(), seed: 3 });
  t.players[0].pos = 22;
  goTo(t, 0);
  assert.equal(t.players[0].cash, 1000 + G.RULES.salary + G.RULES.landBonus);
});

test('buying a lot, then rent from the other player', () => {
  const s = G.newGame({ seats: seats(), seed: 4 });
  const lot = at('Cider Press');
  goTo(s, lot);
  assert.equal(s.pending.kind, 'buy');
  G.decide(s, 'buy');
  assert.equal(s.owner[lot], 0);
  assert.equal(s.players[0].cash, 1000 - 90);
  G.endTurn(s);
  goTo(s, lot);
  assert.equal(s.pending.kind, 'rent');
  const rent = G.rentFor(s, lot);
  assert.equal(rent, Math.round(90 * G.RULES.rent[0] / 5) * 5);
  G.decide(s, 'pay');
  assert.equal(s.players[1].cash, 1050 - rent);
  assert.equal(s.players[0].cash, 910 + rent);
});

test('a forced sale: only of an empty lot whose owner lacks the district', () => {
  const s = G.newGame({ seats: seats(), seed: 5 });
  const [a, b, c] = LOTS_IN.river;
  s.owner[a] = 0; s.owner[b] = 0;
  assert.equal(G.buyoutPrice(s, a), Math.round(G.landValue(s, a) * G.RULES.buyout / 5) * 5);
  s.level[a] = 1;
  assert.equal(G.buyoutPrice(s, a), null, 'built on');
  s.level[a] = 0; s.owner[c] = 0;
  assert.equal(G.buyoutPrice(s, a), null, 'owner has the whole district');
  s.owner[c] = -1;
  s.turn = 1;
  goTo(s, b);
  assert.equal(s.pending.kind, 'rent');
  const price = s.pending.buyout;
  G.decide(s, 'buyout');
  assert.equal(s.owner[b], 1);
  assert.equal(s.players[0].cash, 1000 + price);
  assert.equal(s.players[1].cash, 1050 - price);
});

test('short of cash: the bank lends, income repays first, Payday adds interest', () => {
  const s = G.newGame({ seats: seats(), seed: 6 });
  const lot = at('Belvedere');
  s.owner[lot] = 0; s.level[lot] = 3;
  for (const i of LOTS_IN.hill) s.owner[i] = 0;
  s.turn = 1; s.players[1].cash = 100; s.players[1].pos = 20;
  goTo(s, lot);
  const rent = s.pending.rent;
  assert.ok(rent > 100);
  G.decide(s, 'pay');
  assert.equal(s.players[1].cash, 0);
  assert.equal(s.players[1].debt, rent - 100);
  s.phase = 'manage'; G.endTurn(s); s.phase = 'manage'; G.endTurn(s);
  const debt = s.players[1].debt;
  goTo(s, 2); // passes Payday
  const interest = Math.max(5, Math.ceil(debt * G.RULES.interest / 5) * 5);
  const pay = G.RULES.salary;
  assert.equal(s.players[1].debt, Math.max(0, debt + interest - pay));
  assert.equal(s.players[1].cash, Math.max(0, pay - debt - interest));
});

test('building: a block needs the whole district; every level lifts the street', () => {
  const s = G.newGame({ seats: seats(), seed: 7 });
  const [a, b, c] = LOTS_IN.main;
  s.owner[a] = 0; s.owner[b] = 0; s.phase = 'manage';
  const rentB = G.rentFor(s, b), land = s.land.main;
  G.build(s, a);
  assert.equal(s.level[a], 1);
  assert.ok(s.land.main > land, 'land went up');
  assert.ok(G.rentFor(s, b) > rentB, 'the empty lot beside it earns more');
  G.build(s, a);
  assert.equal(G.canBuild(s, 0, a).ok, false, 'no block without the district');
  s.owner[c] = 0;
  assert.equal(G.canBuild(s, 0, a).ok, true);
  G.build(s, a);
  assert.equal(s.level[a], 3);
  assert.equal(G.canBuild(s, 0, a).ok, false, 'as tall as it goes');
  const cash = s.players[0].cash;
  G.sell(s, a);
  assert.equal(s.level[a], 2);
  assert.equal(s.players[0].cash, cash + G.sellValue(a));
});

test('net worth counts cash, land and buildings, less loans', () => {
  const s = G.newGame({ seats: seats(), seed: 8 });
  const lot = at('Hilltop');
  s.owner[lot] = 0; s.level[lot] = 2; s.players[0].debt = 30; s.players[0].cash = 0;
  assert.equal(G.netWorth(s, 0), G.landValue(s, lot) + 2 * G.buildCost(lot) - 30);
});

test('the Gazette deck reshuffles and every card can be applied', () => {
  for (const card of CARDS) {
    const s = G.newGame({ seats: seats(3), seed: 9 });
    s.deck = [card.id];
    s.players[0].pos = 1;
    goTo(s, 3);
    assert.ok(['manage', 'decide'].includes(s.phase), card.id);
    if (s.phase === 'decide') G.decide(s, s.pending.kind === 'hall' ? 'mill' : s.pending.kind === 'buy' ? 'pass' : s.pending.kind === 'rent' ? 'pay' : 'pass');
    assert.equal(s.phase, 'manage', card.id);
    assert.ok(s.deck.length >= 0);
  }
});

test('rounds end on Founders\' Day with a worth for every round', () => {
  const s = G.newGame({ seats: seats(2), rounds: 2, seed: 10 });
  for (let k = 0; k < 4; k++) { G.roll(s); G.move(s, G.moveOptions(s)[0].steps); if (s.phase === 'decide') G.decide(s, s.pending.kind === 'rent' ? 'pay' : s.pending.kind === 'hall' ? 'mill' : 'pass'); G.endTurn(s); }
  assert.equal(s.phase, 'over');
  assert.equal(s.players[0].history.length, 3);
  assert.throws(() => G.roll(s));
});

test('bots play whole games, the same way every time from the same seed', () => {
  const play = seed => {
    const names = Object.keys(BOTS);
    const s = G.newGame({ seats: names.map((bot, k) => ({ name: BOTS[bot].name, kind: 'bot', bot, token: k })), rounds: 12, seed });
    let n = 0;
    while (s.phase !== 'over') { assert.ok(n++ < 20000, 'game never ended'); botStep(s); }
    return G.standings(s).map(x => x.worth);
  };
  for (let seed = 1; seed <= 40; seed++) play(seed);
  // Every amount stays in whole dollars, all game long.
  for (let seed = 1; seed <= 60; seed++) {
    const s = G.newGame({ seats: Object.keys(BOTS).map((bot, k) => ({ name: bot, kind: 'bot', bot, token: k })), rounds: 20, seed });
    while (s.phase !== 'over') {
      for (const e of botStep(s)) for (const k of ['amount', 'price', 'cost', 'refund']) if (k in e) assert.ok(Number.isInteger(e[k]), `${e.t} ${k} ${e[k]} (seed ${seed})`);
      for (const p of s.players) assert.ok(Number.isInteger(p.cash) && Number.isInteger(p.debt), `cash ${p.cash} debt ${p.debt} (seed ${seed})`);
    }
  }
  assert.deepEqual(play(123), play(123));
});

test('a saved game carries on exactly as if it had never stopped', () => {
  const mk = () => G.newGame({ seats: Object.keys(BOTS).slice(0, 3).map((bot, k) => ({ name: bot, kind: 'bot', bot, token: k })), rounds: 10, seed: 77 });
  const a = mk();
  let b = mk();
  for (let k = 0; k < 150; k++) { botStep(a); botStep(b); }
  b = JSON.parse(JSON.stringify(b));
  while (a.phase !== 'over') botStep(a);
  while (b.phase !== 'over') botStep(b);
  assert.deepEqual(G.standings(a), G.standings(b));
});

test('who is who in a sentence: the person playing alone is You, everyone else goes by name', () => {
  const you = { name: 'You' }, rusty = { name: 'Rusty' };
  assert.deepEqual([W.who(you), W.Who(you), W.whose(you), W.Whose(you), W.agree(you, 'own', 'owns')], ['you', 'You', 'your', 'Your', 'own']);
  assert.deepEqual([W.who(rusty), W.Who(rusty), W.whose(rusty), W.Whose(rusty), W.agree(rusty, 'own', 'owns')], ['Rusty', 'Rusty', "Rusty's", "Rusty's", 'owns']);
});

test("a lot's sheet talks to You as you: no \"You's house\", no \"You owns\"", () => {
  const s = G.newGame({ seats: [{ name: 'You', kind: 'human', token: 0 }, { name: 'Rusty', kind: 'bot', bot: 'rusty', token: 1 }], seed: 5 });
  const [a, b, c] = LOTS_IN.mill;
  for (const i of [a, b, c]) s.owner[i] = 0;
  s.level[a] = 1;
  const mine = W.lotFacts(s, a);
  assert.doesNotMatch(mine, /You's|You owns/);
  assert.match(mine, /Your house\. Rent is/);
  assert.match(mine, /You own all of Mill Row/);
  assert.match(W.lotFacts(s, b), /Your empty lot\./);
  for (const i of [a, b, c]) s.owner[i] = 1;
  const theirs = W.lotFacts(s, a);
  assert.match(theirs, /Rusty's house\. Rent is/);
  assert.match(theirs, /Rusty owns all of Mill Row/);
  s.owner[DEPOTS[0]] = 0;
  assert.match(W.lotFacts(s, DEPOTS[0]), /Your depot\./);
});

// The rents in a lot's table, as numbers.
const tableRents = (s, i) => [...W.rentTable(s, i).matchAll(/<td>\$([\d,]+)<\/td>/g)].map(m => +m[1].replace(/,/g, ''));

test("a lot for sale's rent table is what it would earn once bought, street and whole district counted", () => {
  const s = G.newGame({ seats: [{ name: 'You', kind: 'human', token: 0 }, { name: 'Rusty', kind: 'bot', bot: 'rusty', token: 1 }, { name: 'Dot', kind: 'bot', bot: 'dot', token: 2 }], seed: 5 });
  const [a, b, c] = LOTS_IN.mill;
  s.owner[b] = 1; s.level[b] = 1; s.owner[c] = 2; s.level[c] = 1;
  // Bought by p, then built up to each level, each level putting the land up as a build does.
  const bought = (s, p) => [0, 1, 2, 3].map(lv => G.rentFor({ ...s, land: { ...s.land, mill: +(s.land.mill + lv * G.RULES.rise).toFixed(3) }, owner: { ...s.owner, [a]: p }, level: { ...s.level, [a]: lv } }, a, lv));
  assert.deepEqual(tableRents(s, a), bought(s, 0));
  assert.ok(tableRents(s, a)[0] > Math.round(G.landValue(s, a) * G.RULES.rent[0] / 5) * 5, "the street's bonus is left out");
  // The person owns the other two: buying this one makes the whole district theirs.
  s.owner[b] = 0; s.owner[c] = 0;
  assert.deepEqual(tableRents(s, a), bought(s, 0));
  assert.equal(tableRents(s, a)[0], G.rentFor({ ...s, owner: { ...s.owner, [a]: 0 } }, a), 'the whole district is left out');
  // On a townsperson's turn it's still reckoned for the one person at the table; in a game of several people, for
  // nobody in particular, so only the street counts.
  s.turn = 1;
  assert.deepEqual(tableRents(s, a), bought(s, 0));
  s.players[2].kind = 'human';
  assert.deepEqual(tableRents(s, a), bought(s, 3));
  // A lot nobody owns earns nothing until it's bought.
  assert.equal(G.rentFor(s, a), 0);
});

test("an owned lot's rent table is unchanged up to its level", () => {
  const s = G.newGame({ seats: seats(2), seed: 7 });
  const [a, b, c] = LOTS_IN.river;
  s.owner[a] = 0; s.level[a] = 2; s.owner[b] = 1; s.level[b] = 1; s.land.river = 1.3;
  assert.deepEqual(tableRents(s, a).slice(0, 3), [0, 1, 2].map(lv => G.rentFor(s, a, lv)));
  s.owner[b] = 0; s.owner[c] = 0;
  assert.deepEqual(tableRents(s, a).slice(0, 3), [0, 1, 2].map(lv => G.rentFor(s, a, lv)));
});

test('the rent after a build counts the land it raises, as the build does', () => {
  const s = G.newGame({ seats: seats(2), seed: 7 });
  const [a, b, c] = LOTS_IN.river;
  for (const i of [a, b, c]) s.owner[i] = 0;
  s.level[b] = 1; s.players[0].cash = 99999; s.phase = 'manage';
  const built = t => { const u = structuredClone(t); G.build(u, a); return u; };
  for (const land of [1, 1.37, 2.95, 3]) {
    s.land.river = land;
    const steps = [];
    for (let t = structuredClone(s); t.level[a] < G.RULES.maxLevel; t = built(t)) {
      const after = built(t);
      assert.equal(W.rentAfterBuild(t, a), G.rentFor(after, a), `land ${land}, level ${t.level[a]}`);
      steps.push(G.rentFor(after, a));
    }
    // The rent table's rows above the lot's level are those same rents.
    assert.deepEqual(tableRents(s, a).slice(1), steps, `land ${land}`);
  }
  assert.ok(W.rentAfterBuild(s, a) >= G.rentFor(s, a, 1));
  s.land.river = 1;
  assert.ok(W.rentAfterBuild(s, a) > G.rentFor(s, a, 1), 'the land the build raises is left out');
});

test("a block's reason names the lot it's missing, and who has it", () => {
  const s = G.newGame({ seats: seats(), seed: 9 });
  const [a, b, c] = LOTS_IN.mill;
  s.owner[a] = 0; s.level[a] = 2; s.owner[b] = 1; s.phase = 'manage';
  const name = i => SPACES[i].name;
  assert.equal(G.canBuild(s, 0, a).reason, `A block needs all three Mill Row lots. ${name(b)} is P1's and ${name(c)} is still for sale.`);
  s.owner[b] = 0;
  assert.equal(G.canBuild(s, 0, a).reason, `A block needs all three Mill Row lots. ${name(c)} is still for sale.`);
});

test("a person's empty lot warns that a rival landing there can force a sale, and stops once it can't", () => {
  const s = G.newGame({ seats: [{ name: 'You', kind: 'human', token: 0 }, { name: 'Rusty', kind: 'bot', bot: 'rusty', token: 1 }], seed: 6 });
  const [a, b, c] = LOTS_IN.mill;
  s.owner[a] = 0;
  const warned = i => /A rival who lands here can make you sell it for \$\d+\. Build on it, or own the whole district, to keep it\./.test(W.lotFacts(s, i, { warn: true }));
  assert.equal(warned(a), true);
  assert.equal(W.lotFacts(s, a).includes('A rival'), false, 'only the owner-side sheet warns');
  s.owner[b] = 0; s.owner[c] = 0;
  assert.equal(warned(a), false, 'the whole district keeps it');
  s.owner[c] = -1; s.level[a] = 1;
  assert.equal(warned(a), false, 'a house keeps it');
  s.level[a] = 0; s.owner[a] = 1;
  assert.equal(W.lotFacts(s, a, { warn: true }).includes('A rival'), false, "the townsfolk's lots don't warn");
  s.owner[DEPOTS[0]] = 0;
  assert.match(W.lotFacts(s, DEPOTS[0], { warn: true }), /make you sell it for \$\d+\. Own both depots to keep it\./);
});

// A bot's game at a given round, with the bot to play in seat 0.
function botGame(bot = 'rusty', { round = 10, rounds = 20, players = 4 } = {}) {
  const names = [bot, ...Object.keys(BOTS).filter(b => b !== bot)].slice(0, players);
  const s = G.newGame({ seats: names.map((b, k) => ({ name: BOTS[b].name, kind: 'bot', bot: b, token: k })), rounds, seed: 11 });
  s.round = round;
  return s;
}

test('a townsperson sells a building to clear only a big loan, and never in the last three rounds', () => {
  const sells = (round, debt) => {
    const s = botGame('rusty', { round });
    const lot = at('Hilltop');
    s.owner[lot] = 0; s.level[lot] = 2;
    s.players[0].cash = 0; s.players[0].debt = debt; s.phase = 'manage';
    return botStep(s).some(e => e.t === 'sell');
  };
  assert.equal(sells(10, 500), true, 'a big loan mid-game still sells');
  assert.equal(sells(10, 200), false, 'a small loan rides');
  for (const round of [18, 19, 20]) assert.equal(sells(round, 900), false, `round ${round} of 20`);
});

test('in the final round a townsperson never forces a sale: it costs half as much again as it adds to their worth', () => {
  const setup = round => {
    const s = botGame('dot', { round });
    const [a, b, c] = LOTS_IN.hill;
    s.owner[a] = 0; s.owner[b] = 0; s.owner[c] = 1; // Dot's third Hilltop lot would finish the district
    s.players[0].cash = 3000;
    s.players[0].pos = (c - 5 + N) % N;
    return { s, c };
  };
  // Where the move scorer stands: the rent alone, with nothing added for a sale.
  const { s: early, c } = setup(10);
  assert.ok(scoreSpace(early, c, 5) > -G.rentFor(early, c), 'mid-game the sale counts for the move');
  const { s: last } = setup(20);
  assert.equal(scoreSpace(last, c, 5), -G.rentFor(last, c), 'in the final round only the rent counts');
  for (const [s, want] of [[early, 'buyout'], [last, 'pay']]) {
    goTo(s, c);
    assert.equal(s.pending.kind, 'rent');
    assert.equal(chooseDecision(s), want, `round ${s.round}`);
  }
});

test('Dot forces a sale only to get a whole street', () => {
  // Rusty owns one Hilltop lot; the other two are still for sale, or one of them is Mabel's, or both are the forcer's.
  const sale = (bot, { mine = 0, mabels = 0, round = 10 } = {}) => {
    const s = botGame(bot, { round });
    const [a, b, c] = LOTS_IN.hill;
    s.owner[c] = s.players.findIndex(pl => pl.bot === 'rusty');
    [a, b].slice(0, mine).forEach(i => { s.owner[i] = 0; });
    [b, a].slice(0, mabels).forEach(i => { s.owner[i] = s.players.findIndex(pl => pl.bot === 'mabel'); });
    s.players[0].cash = 3000;
    goTo(s, c);
    assert.equal(s.pending.kind, 'rent');
    return chooseDecision(s);
  };
  assert.equal(sale('dot'), 'pay', 'a lone lot, the rest unsold, but Dot would still be two short');
  assert.equal(sale('dot', { mine: 1 }), 'buyout', 'one short, and the last lot still for sale');
  assert.equal(sale('dot', { mine: 1, round: 18 }), 'pay', 'one short with two rounds left to buy the last lot');
  assert.equal(sale('dot', { mine: 1, round: 17 }), 'buyout', 'one short with three rounds left');
  assert.equal(sale('dot', { mine: 1, mabels: 1 }), 'pay', "one short, but the last lot is Mabel's");
  assert.equal(sale('dot', { mine: 2 }), 'buyout', 'it finishes Hilltop');
  // It's her wish for streets that stops her: without it she'd force the sale that gets her nowhere.
  BOTS.dot.streets = false;
  try { assert.equal(sale('dot'), 'buyout'); } finally { BOTS.dot.streets = true; }
  // A depot is half of a pair: Dot forces the sale of one only when the other is hers or still for sale.
  const depot = other => {
    const s = botGame('dot');
    const [d, e] = DEPOTS;
    s.owner[d] = 1; s.owner[e] = other;
    s.players[0].cash = 3000;
    goTo(s, d);
    return chooseDecision(s);
  };
  assert.equal(depot(0), 'buyout');
  assert.equal(depot(-1), 'buyout');
  assert.equal(depot(2), 'pay');
});

test("the move a townsperson picks never counts a buy or a forced sale they'd then turn down", () => {
  // Mabel keeps a $300 cushion: with $200 to spare after the price she passes, so the move there scores nothing for it.
  const offer = spare => {
    const s = botGame('mabel');
    const lot = at('Hilltop');
    s.players[0].cash = G.landValue(s, lot) + spare;
    s.players[0].pos = (lot - 5 + N) % N;
    const score = scoreSpace(s, lot, 5);
    goTo(s, lot);
    return [score > 0, chooseDecision(s)];
  };
  assert.deepEqual(offer(200), [false, 'pass']);
  assert.deepEqual(offer(400), [true, 'buy']);
  // Dot keeps 40% of her cushion after a forced sale; short of that she pays the rent, and the move counts only the rent.
  const sale = spare => {
    const s = botGame('dot');
    const [a, b, c] = LOTS_IN.hill;
    s.owner[a] = 0; s.owner[b] = 0; s.owner[c] = 1;
    s.players[0].cash = G.buyoutPrice(s, c) + spare;
    s.players[0].pos = (c - 5 + N) % N;
    const score = scoreSpace(s, c, 5) + G.rentFor(s, c);
    goTo(s, c);
    return [score > 0, chooseDecision(s)];
  };
  assert.deepEqual(sale(20), [false, 'pay']);
  assert.deepEqual(sale(400), [true, 'buyout']);
});

test("at City Hall a townsperson rezones where they have the most riding on it, rivals' land counted against", () => {
  const s = botGame('mabel');
  s.owner[at('Hilltop')] = 0; s.owner[at('Lookout Point')] = 1; s.owner[at('Belvedere')] = 2;
  s.owner[at('Riverside')] = 0;
  s.pending = { kind: 'hall' }; s.phase = 'decide';
  assert.equal(chooseDecision(s), 'river', "Hilltop would lift $500 of rivals' land with Mabel's $240");
  // Owning nothing, they lift a district nobody owns rather than a rival's.
  const t = botGame('mabel');
  for (const i of LOTS_IN.mill) t.owner[i] = 1;
  t.pending = { kind: 'hall' }; t.phase = 'decide';
  assert.notEqual(chooseDecision(t), 'mill');
});

test('a townsperson takes the free gains at the end: a final-round build, the Lumberyard, the Estate sale', () => {
  // In the final round building is worth what it costs, and lifts the street's land, so it's never a loss.
  const s = botGame('mabel', { round: 20 });
  for (const i of LOTS_IN.river) s.owner[i] = 0;
  s.players[0].cash = 500; s.phase = 'manage';
  assert.ok(botStep(s).some(e => e.t === 'build'), 'builds in the final round');
  s.pending = { kind: 'yard' }; s.phase = 'decide';
  assert.equal(typeof chooseDecision(s), 'number', 'takes the Lumberyard in the final round');
  // The Estate sale: a lot at half its land value is worth taking even short of a cushion.
  const t = botGame('mabel');
  t.players[0].cash = 100;
  for (const i of OWNABLE) if (G.landValue(t, i) > 100) t.owner[i] = 1;
  t.pending = { kind: 'estate' }; t.phase = 'decide';
  const pick = chooseDecision(t);
  assert.equal(typeof pick, 'number');
  assert.equal(SPACES[pick].type, 'lot');
});

test("a townsperson reckons the Estate sale's half price to the $5, as the sale charges it", () => {
  // Tannery Lane on $75 of land costs $40, not $38: with $38, Rusty can't buy it.
  const t = botGame('rusty');
  t.land.mill = 1.25;
  for (const i of OWNABLE) t.owner[i] = i === at('Tannery Lane') ? -1 : 1;
  t.players[0].cash = 38;
  t.pending = { kind: 'estate' }; t.phase = 'decide';
  assert.doesNotThrow(() => G.decide(t, chooseDecision(t)));
});

// The words quote the numbers the rules use. How to play and the sheets are written from RULES, the README by hand, so
// a change to RULES that leaves the text behind fails here.
test('the rules text quotes the numbers in RULES', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8'), rules = W.rulesHtml();
  const s = G.newGame({ seats: [{ name: 'You', kind: 'human', token: 0 }, { name: 'B', kind: 'human', token: 1 }], seed: 1 });
  const facts = W.lotFacts(s, LOTS_IN.mill[0]);
  const street = `${Math.round(G.RULES.street * 100)}%`;
  for (const [where, text] of [['How to play', rules], ['README', readme], ['a lot sheet', facts]]) {
    if (G.RULES.street !== 0.25) assert.doesNotMatch(text, /a quarter/, `${where} says a building adds a quarter, but RULES.street is ${G.RULES.street}`);
    assert.ok(text.includes(`with a building on it adds ${street} to the rent of the other lots there`), `${where} doesn't give the street's bonus as ${street} for each lot built on`);
  }
  const [, one, both] = G.RULES.depotRent;
  if (both !== 2 * one) assert.doesNotMatch(SPACE_HELP.depot ?? '', /doubles/, `depot rent goes ${one} -> ${both}`);
  assert.ok(W.SAYS.tax.includes(`$${G.RULES.taxPerLevel} for every building level`), 'the Assessor help gives the charge per level');
  assert.ok(W.SAYS.tax.includes(`never less than $${G.RULES.taxMin},`), 'the Assessor help gives the least it charges');
  // How to play and the README go round the board: the Assessor, the depots, the detours.
  const words = ['no', 'one', 'two', 'three'];
  for (const [where, text] of [['How to play', rules], ['README', readme]]) {
    assert.ok(text.includes(`$${G.RULES.taxPerLevel} for every building level you own, and never less than $${G.RULES.taxMin}, into the kitty`), `${where} doesn't say what the Assessor charges`);
    assert.ok(text.includes(`$${one}, or $${both} when one player owns both`), `${where} doesn't give depot rents of $${one} and $${both}`);
    assert.ok(text.includes(`start with ${words[G.RULES.detours]} detours and can hold ${words[G.RULES.detourMax]}`), `${where} doesn't say how many detours you start with and can hold`);
    assert.match(text, /Lumberyard/);
    assert.match(text, /estate sale/i);
  }
  // City Hall adds RULES.hall to the land, a share of its first price, not of what it stands at now.
  const fifth = { 0.2: 'a fifth' }[G.RULES.hall];
  assert.ok(fifth, `RULES.hall is ${G.RULES.hall}: City Hall's help says it puts land up by a fifth of its first price`);
  for (const [where, text] of [['How to play', rules], ['README', readme], ["City Hall's sheet", SPACE_HELP.hall], ['the help', W.SAYS.hall]]) {
    assert.ok(text.includes(`up by ${fifth} of its first price`), `${where} doesn't say City Hall puts land up by ${fifth} of its first price`);
    assert.doesNotMatch(text, /City Hall[^.]*20%/, `${where} says City Hall puts land up 20%`);
  }
  // A loan's interest is a tenth, rounded up to the $5, never less than $5: a $5 loan pays $5, not 10%.
  const tenth = { 0.1: 'a tenth' }[G.RULES.interest];
  assert.ok(tenth, `RULES.interest is ${G.RULES.interest}: the README says a loan's interest is a tenth`);
  for (const [where, text] of [['How to play', rules], ['README', readme], ['the help', W.SAYS.interest]]) {
    assert.ok(text.includes(`adds ${tenth}, rounded up to the next $5 (at least $5), each time you pass Payday`), `${where} doesn't say how a loan's interest is reckoned`);
    assert.doesNotMatch(text, /10% each/, `${where} says a loan costs 10% each Payday`);
  }
});

test("a loan's interest at Payday is a tenth, rounded up to the next $5, and never less than $5", () => {
  for (const [debt, interest] of [[5, 5], [40, 5], [55, 10], [260, 30], [300, 30], [1234, 125]]) {
    const s = G.newGame({ seats: seats(), seed: 3 });
    s.players[0].cash = 0; s.players[0].debt = debt; s.players[0].pos = N - 2;
    const ev = goTo(s, 2);
    assert.equal(ev.find(e => e.t === 'interest')?.amount, interest, `interest on a $${debt} loan`);
  }
});

test("City Hall adds RULES.hall to a district's land, and land stays between its least and its most", () => {
  const s = G.newGame({ seats: seats(), seed: 9 });
  s.land.mill = 1.22; s.players[0].pos = 18;
  goTo(s, at('City Hall'));
  assert.equal(s.pending.kind, 'hall');
  assert.deepEqual(G.decide(s, 'mill').find(e => e.t === 'land'), { t: 'land', d: 'mill', from: 1.22, to: Math.round((1.22 + G.RULES.hall) * 1000) / 1000 });
  // Near the top it goes only as high as land goes, and at the top nothing moves.
  for (const [from, to] of [[G.RULES.landMax - 0.1, G.RULES.landMax], [G.RULES.landMax, G.RULES.landMax]]) {
    const t = G.newGame({ seats: seats(), seed: 9 });
    t.land.hill = from; t.players[0].pos = 18;
    goTo(t, at('City Hall'));
    const ev = G.decide(t, 'hill');
    assert.equal(t.land.hill, to);
    assert.equal(ev.some(e => e.t === 'land'), from !== to, 'a land event only when the land moved');
    assert.ok(ev.some(e => e.t === 'rezone'));
  }
  // At the bottom: a bust in the Gazette, or a sale, takes land no lower than the least.
  const u = G.newGame({ seats: seats(), seed: 9 });
  u.land.river = G.RULES.landMin + 0.05; u.deck = ['bust-river']; u.players[0].pos = 1;
  goTo(u, 3);
  assert.equal(u.land.river, G.RULES.landMin);
  const lot = LOTS_IN.river[0];
  u.owner[lot] = 0; u.level[lot] = 1; u.phase = 'manage';
  assert.equal(G.sell(u, lot).some(e => e.t === 'land'), false);
  assert.equal(u.land.river, G.RULES.landMin);
});

test('the Lumberyard builds one level on one of your lots at half its cost', () => {
  const s = G.newGame({ seats: seats(), seed: 10 });
  const [a] = LOTS_IN.mill, theirs = LOTS_IN.main[0];
  s.owner[a] = 0; s.owner[theirs] = 1; s.players[0].pos = 8;
  goTo(s, at('Lumberyard'));
  assert.equal(s.pending.kind, 'yard');
  assert.throws(() => G.decide(s, theirs), /Not yours/);
  const land = s.land.mill;
  G.decide(s, a);
  assert.equal(s.level[a], 1);
  assert.equal(s.players[0].cash, 1000 - Math.round(G.buildCost(a) / 2));
  assert.equal(s.land.mill, Math.round((land + G.RULES.rise) * 1000) / 1000, 'it lifts the street as any build does');
  // With nothing of yours to build on, the Lumberyard asks nothing.
  const t = G.newGame({ seats: seats(), seed: 10 });
  t.players[0].pos = 8;
  goTo(t, at('Lumberyard'));
  assert.equal(t.pending, null);
});

test('the Estate sale sells any empty lot, not a depot, at half its land value to the $5', () => {
  const s = G.newGame({ seats: seats(), seed: 11 });
  s.land.mill = 1.25; s.deck = ['estate']; s.players[0].pos = 1;
  goTo(s, 3);
  assert.equal(s.pending.kind, 'estate');
  assert.throws(() => G.decide(s, DEPOTS[0]), /not for sale/);
  const lot = at('Tannery Lane'); // $75 of land: half is $37.50, so $40
  G.decide(s, lot);
  assert.deepEqual([s.owner[lot], s.players[0].cash], [0, 1000 - 40]);
});

test('the Land Office sells any empty lot or depot at its price', () => {
  const s = G.newGame({ seats: seats(), seed: 12 });
  s.players[0].pos = 4;
  goTo(s, at('Land Office'));
  assert.equal(s.pending.kind, 'office');
  G.decide(s, DEPOTS[0]);
  assert.deepEqual([s.owner[DEPOTS[0]], s.players[0].cash], [0, 1000 - SPACES[DEPOTS[0]].price]);
  const t = G.newGame({ seats: seats(), seed: 12 });
  t.players[0].pos = 4; t.owner[DEPOTS[0]] = 1;
  goTo(t, at('Land Office'));
  assert.throws(() => G.decide(t, DEPOTS[0]), /not for sale/, "someone's depot");
});

test('the Assessor charges every building level, never less than its least, into the kitty; Town Square pays the kitty out', () => {
  for (const [levels, charge] of [[0, G.RULES.taxMin], [1, G.RULES.taxMin], [3, 3 * G.RULES.taxPerLevel]]) {
    const s = G.newGame({ seats: seats(), seed: 13 });
    const lots = LOTS_IN.main;
    lots.forEach((i, k) => { s.owner[i] = 0; s.level[i] = k < levels ? 1 : 0; });
    const kitty = s.kitty, cash = s.players[0].cash;
    s.players[0].pos = 20;
    goTo(s, at('Assessor'));
    assert.deepEqual([s.players[0].cash, s.kitty], [cash - charge, kitty + charge], `${levels} levels`);
  }
  const t = G.newGame({ seats: seats(), seed: 13 });
  t.kitty = 175; t.players[0].pos = 11;
  const ev = goTo(t, at('Town Square'));
  assert.deepEqual([t.players[0].cash, t.kitty], [1175, 0]);
  assert.deepEqual(ev.find(e => e.t === 'kitty'), { t: 'kitty', p: 0, amount: 175 });
  t.phase = 'manage'; G.endTurn(t); t.players[1].pos = 11;
  goTo(t, at('Town Square'));
  assert.equal(t.players[1].cash, 1050, 'an empty kitty pays nothing');
});

test("depot rent: one depot's, or both depots' when one player owns both, and no forced sale then", () => {
  const s = G.newGame({ seats: seats(), seed: 14 });
  const [a, b] = DEPOTS;
  s.owner[a] = 1;
  assert.equal(G.rentFor(s, a), G.RULES.depotRent[1]);
  assert.notEqual(G.buyoutPrice(s, a), null);
  s.owner[b] = 1;
  assert.equal(G.rentFor(s, a), G.RULES.depotRent[2]);
  assert.equal(G.buyoutPrice(s, a), null);
  s.players[0].pos = 2;
  goTo(s, a);
  assert.deepEqual([s.pending.kind, s.pending.rent, s.pending.buyout], ['rent', G.RULES.depotRent[2], null]);
});

test('detours: Payday gives one back, but never more than RULES.detourMax', () => {
  const s = G.newGame({ seats: seats(), seed: 15 });
  assert.equal(s.players[0].detours, G.RULES.detourMax);
  s.players[0].pos = 25;
  goTo(s, 2);
  assert.equal(s.players[0].detours, G.RULES.detourMax);
});

test('a building can be sold back only before rolling or after the space is dealt with', () => {
  const s = G.newGame({ seats: seats(), seed: 16 });
  const lot = LOTS_IN.main[0];
  s.owner[lot] = 0; s.level[lot] = 1;
  s.dice = [2, 3]; s.phase = 'move';
  assert.throws(() => G.sell(s, lot), /not time to sell/, 'while moving');
  s.players[0].pos = 1;
  goTo(s, at('Cider Press'));
  assert.equal(s.phase, 'decide');
  assert.throws(() => G.sell(s, lot), /not time to sell/, 'while deciding');
  assert.equal(s.level[lot], 1);
  G.decide(s, 'pass');
  G.sell(s, lot);
  assert.equal(s.level[lot], 0);
});

// Random legal players and the townsfolk, every action, 2-4 seats, short games: money adds up action by action (the
// bank, the kitty, loans), a loan is held only with no cash, and every turn ends with nothing left pending.
function mk(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function legal(s) {
  const q = s.pending, p = s.turn, pl = G.current(s), half = i => Math.round(G.landValue(s, i) / 2 / 5) * 5;
  switch (q.kind) {
    case 'buy': return pl.cash >= q.price ? ['buy', 'pass'] : ['pass'];
    case 'rent': return q.buyout != null && pl.cash >= q.buyout ? ['pay', 'buyout'] : ['pay'];
    case 'office': return [...G.emptyLots(s).filter(i => pl.cash >= G.landValue(s, i)), 'pass'];
    case 'estate': return [...G.emptyLots(s).filter(i => SPACES[i].type === 'lot' && pl.cash >= half(i)), 'pass'];
    case 'yard': return [...OWNABLE.filter(i => G.canBuild(s, p, i, 0.5).ok), 'pass'];
    case 'hall': return DISTRICTS.map(d => d.id);
  }
}
test('random players and bots: money adds up and nothing is left over between turns', () => {
  const wealth = s => s.players.reduce((t, p) => t + p.cash - p.debt, 0) + s.kitty;
  const NEXT = { roll: ['roll', 'move'], move: ['decide', 'manage'], decide: ['manage'], manage: ['manage', 'roll', 'over'] };
  for (let g = 0; g < 120; g++) {
    const n = 2 + g % 3, r = mk(g + 1), names = Object.keys(BOTS);
    const s = G.newGame({ seats: Array.from({ length: n }, (_, k) => (k + g) % 2 ? { name: 'P' + k, kind: 'human', token: k } : { name: names[k], kind: 'bot', bot: names[k], token: k }), rounds: 8, seed: g + 1 });
    const pick = a => a[Math.floor(r() * a.length)];
    let turns = 0;
    while (s.phase !== 'over') {
      const before = wealth(s), phase = s.phase, turn = s.turn;
      let ev;
      if (G.current(s).kind === 'bot') ev = botStep(s);
      else if (s.phase === 'roll') ev = G.roll(s);
      else if (s.phase === 'move') { const o = pick(G.moveOptions(s).filter(o => o.usable)); ev = G.move(s, o.steps, o.detour); }
      else if (s.phase === 'decide') ev = G.decide(s, pick(legal(s)));
      else { const b = OWNABLE.filter(i => G.canBuild(s, s.turn, i).ok), x = r(); ev = x < 0.3 && b.length ? G.build(s, pick(b)) : x < 0.35 && OWNABLE.some(i => G.canSell(s, s.turn, i)) ? G.sell(s, pick(OWNABLE.filter(i => G.canSell(s, s.turn, i)))) : G.endTurn(s); }
      // the bank's money in and out, as the events tell it
      let bank = 0;
      for (const e of ev) {
        if (e.t === 'collect' && e.why !== 'the kitty') bank += e.amount;
        if (e.t === 'pay' && e.to === 'bank') bank -= e.amount;
        if (e.t === 'interest') bank -= e.amount;
      }
      const ctx = `(game ${g}, round ${s.round}, ${phase} -> ${s.phase})`;
      assert.equal(wealth(s), before + bank, `money adds up ${ctx}`);
      assert.ok(phase === s.phase || NEXT[phase].includes(s.phase), `phase ${ctx}`);
      assert.equal(s.pending != null, s.phase === 'decide', `pending only while deciding ${ctx}`);
      for (const p of s.players) {
        assert.ok(p.cash >= 0 && Number.isInteger(p.cash) && Number.isInteger(p.debt), `cash ${ctx}`);
        assert.ok(p.debt === 0 || p.cash === 0, `a loan with cash in hand ${ctx}`);
        assert.ok(p.detours >= 0 && p.detours <= G.RULES.detourMax, `detours ${ctx}`);
      }
      for (const i of OWNABLE) {
        assert.ok(s.level[i] >= 0 && s.level[i] <= G.RULES.maxLevel, `level ${ctx}`);
        if (s.level[i] === G.RULES.maxLevel) assert.ok(G.ownsDistrict(s, s.owner[i], SPACES[i].district), `a block without its district ${ctx}`);
      }
      for (const d of DISTRICTS) assert.ok(s.land[d.id] >= G.RULES.landMin && s.land[d.id] <= G.RULES.landMax, `land ${ctx}`);
      if (phase === 'manage' && s.phase !== 'manage') { turns++; assert.equal(s.dice, null); assert.equal(s.pending, null); assert.notEqual(s.turn, turn); }
    }
    assert.equal(turns, 8 * n, `every seat gets exactly ${8} turns (game ${g})`);
    assert.ok(s.players.every(p => p.history.length === 9));
  }
});

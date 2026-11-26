// The rules, without a browser:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
import { botStep, BOTS, chooseDecision, scoreSpace } from '../js/bots.js';
import { SPACES, LOTS_IN, OWNABLE, N, DEPOTS } from '../js/board.js';
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

test("a townsperson reckons the Estate sale's half price to the $5, as the sale charges it", () => {
  // Tannery Lane on $75 of land costs $40, not $38: with $38, Rusty can't buy it.
  const t = botGame('rusty');
  t.land.mill = 1.25;
  for (const i of OWNABLE) t.owner[i] = i === at('Tannery Lane') ? -1 : 1;
  t.players[0].cash = 38;
  t.pending = { kind: 'estate' }; t.phase = 'decide';
  assert.doesNotThrow(() => G.decide(t, chooseDecision(t)));
});

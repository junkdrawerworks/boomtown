// Plays many bot-only games and prints how they went, for tuning the numbers in RULES.
// node test/sim.mjs [games] [rounds] [players]
import { newGame, standings, netWorth, RULES } from '../js/game.js';
import { botStep, BOTS } from '../js/bots.js';
import { OWNABLE, SPACES, DISTRICTS, LOTS_IN } from '../js/board.js';

const games = +process.argv[2] || 2000, rounds = +process.argv[3] || 20, players = +process.argv[4] || 4;
const names = Object.keys(BOTS);
const wins = {}, seatWins = Array(players).fill(0), worths = [], margins = [], loans = [], levels = [], owned = [], kinds = {};
const steps = [], builtBy = {}, buyouts = [], debtEnd = [], landEnd = {};
const districtRent = {}; let rentN = 0, rentTotal = 0, rentBig = 0, rentMax = [];
for (let g = 0; g < games; g++) {
  // Rotate personalities round the seats.
  const seats = Array.from({ length: players }, (_, k) => {
    const bot = names[(g + k) % names.length];
    return { name: BOTS[bot].name, kind: 'bot', bot, token: k };
  });
  const s = newGame({ seats, rounds, seed: g + 1 });
  let n = 0, bo = 0, maxLoan = 0, gMax = 0;
  while (s.phase !== 'over' && n < 100000) {
    const ev = botStep(s);
    for (const e of ev) {
      if (e.t === 'buyout') bo++;
      if (e.t === 'pay' && typeof e.to === 'number' && e.why.startsWith('rent')) {
        const d = SPACES[+Object.keys(SPACES).find(i => e.why === 'rent on ' + SPACES[i].name)].district || 'depot';
        districtRent[d] = (districtRent[d] || 0) + e.amount;
        rentN++; rentTotal += e.amount; if (e.amount >= 200) rentBig++; gMax = Math.max(gMax, e.amount);
      }
    }
    s.players.forEach(p => { maxLoan = Math.max(maxLoan, p.debt); });
    n++;
  }
  steps.push(n); rentMax.push(gMax);
  buyouts.push(bo);
  loans.push(maxLoan);
  const st = standings(s);
  wins[s.players[st[0].p].bot] = (wins[s.players[st[0].p].bot] || 0) + 1;
  seatWins[st[0].p]++;
  worths.push(st[0].worth);
  margins.push(st[0].worth - st[1].worth);
  levels.push(OWNABLE.reduce((t, i) => t + s.level[i], 0));
  owned.push(OWNABLE.filter(i => s.owner[i] >= 0).length);
  debtEnd.push(s.players.filter(p => p.debt > 0).length);
  for (const d of DISTRICTS) (landEnd[d.id] ||= []).push(s.land[d.id]);
}
const avg = a => (a.reduce((t, x) => t + x, 0) / a.length);
const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)];
console.log(`${games} games, ${rounds} rounds, ${players} players`);
console.log('wins by bot', Object.fromEntries(Object.entries(wins).map(([k, v]) => [k, (100 * v / games).toFixed(1) + '%'])));
console.log('wins by seat', seatWins.map(v => (100 * v / games).toFixed(1) + '%').join(' '));
console.log('winner worth  avg', avg(worths).toFixed(0), 'p10', pct(worths, .1), 'p90', pct(worths, .9));
console.log('margin 1st-2nd avg', avg(margins).toFixed(0), 'median', pct(margins, .5));
console.log('levels built avg', avg(levels).toFixed(1), 'of', 18 * 3, ' lots owned avg', avg(owned).toFixed(1), 'of', OWNABLE.length);
console.log('buyouts per game', avg(buyouts).toFixed(2), ' max loan avg', avg(loans).toFixed(0), ' players in debt at end', avg(debtEnd).toFixed(2));
console.log('land at end', Object.fromEntries(Object.entries(landEnd).map(([k, v]) => [k, avg(v).toFixed(2)])));
console.log('rent by district', JSON.stringify(Object.fromEntries(Object.entries(districtRent).map(([k, v]) => [k, Math.round(v / games)]))));
console.log('rent: payments/game', (rentN / games).toFixed(1), 'avg', (rentTotal / rentN).toFixed(0), 'total/game', (rentTotal / games).toFixed(0), '>=200 per game', (rentBig / games).toFixed(2), 'biggest avg', avg(rentMax).toFixed(0));
console.log('bot steps per game', avg(steps).toFixed(0));

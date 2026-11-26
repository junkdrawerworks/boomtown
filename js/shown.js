// The game as the screen shows it while a move plays out. game.js works a whole move out at once and says what
// happened as a list of events; the screen shows them one at a time, so the players' cards, the tags on the board, the
// kitty and the dice should change as each one is shown (the piece arrives, the rent is paid, the headline lands), not
// all at once when the move is made. copy(s) is a copy of the game as it stood before the move, and step(v, e) moves
// the copy on by one event, the way game.js moved the game. No screen here: test/unit.test.mjs checks that a copy
// stepped through every event ends where the game did.

import { RULES } from './game.js';

export const copy = s => JSON.parse(JSON.stringify({ ...s, log: [], since: null }));

export function step(v, e) {
  const pl = q => v.players[q];
  switch (e.t) {
    case 'roll': v.dice = [...e.dice]; v.phase = 'move'; break;
    case 'detour': pl(e.p).detours = e.left; break;
    case 'move': pl(e.p).pos = e.path[e.path.length - 1]; break;
    case 'collect':
      pl(e.p).cash += e.amount;
      if (e.why === 'the kitty') v.kitty = 0;
      // Passing Payday gives a detour back, up to the most anyone can hold.
      if (e.why.startsWith('Payday')) pl(e.p).detours = Math.min(RULES.detourMax, pl(e.p).detours + 1);
      break;
    // A loan comes before the payment it's for: the bank's money goes out with the rest.
    case 'loan': pl(e.p).debt += e.amount; pl(e.p).cash += e.amount; break;
    case 'pay':
      pl(e.from).cash -= e.amount;
      if (e.to === 'kitty') v.kitty += e.amount;
      else if (typeof e.to === 'number') pl(e.to).cash += e.amount;
      break;
    case 'repaid': pl(e.p).debt -= e.amount; pl(e.p).cash -= e.amount; break;
    case 'interest': pl(e.p).debt += e.amount; break;
    case 'land': v.land[e.d] = e.to; break;
    case 'buy': case 'buyout': v.owner[e.at] = e.p; break;
    case 'build': case 'sell': v.level[e.at] = e.level; break;
    case 'turn': v.turn = e.p; v.round = e.round; v.phase = 'roll'; v.dice = null; v.pending = null; break;
    case 'over': v.turn = 0; v.phase = 'over'; v.dice = null; v.pending = null; break;
  }
  return v;
}

// Boomtown's words, with no screen: amounts, who's who in a sentence, and the facts on a lot's sheet. app.js and
// view.js write with these, and test/unit.test.mjs reads them in Node.

import { SPACES, DISTRICT, LOTS_IN } from './board.js';
import * as G from './game.js';

export const money = n => (n < 0 ? `−$${(-n).toLocaleString('en-US')}` : `$${n.toLocaleString('en-US')}`);
export const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The one person playing the townsfolk is called You, and the game talks to them: "Your house", "You own all of Mill
// Row". (With more than one person at the table nobody is called You: see the title screen's Break ground.) Everyone
// else goes by their name. Plain text: escape it for HTML.
export const isYou = pl => pl.name === 'You';
export const who = pl => (isYou(pl) ? 'you' : pl.name); // in the middle of a sentence
export const Who = pl => (isYou(pl) ? 'You' : pl.name); // at the start of one
export const whose = pl => (isYou(pl) ? 'your' : `${pl.name}'s`);
export const Whose = pl => (isYou(pl) ? 'Your' : `${pl.name}'s`);
// The verb to go with them: agree(pl, 'own', 'owns').
export const agree = (pl, you, they) => (isYou(pl) ? you : they);

export const swatch = d => `<span class="swatch" style="background:${DISTRICT[d].color}"></span>`;

// What lot i would rent for at `level`, with `owner` owning it (a lot for sale reckoned as if bought), built up to
// that level from where it stands. Each level built raises its district's land, as game.js's build does (shiftLand,
// to the same thousandth and within the same bounds), so the rents above a lot's level count that too.
export function rentAt(s, i, level, owner = s.owner[i]) {
  const d = SPACES[i].district, land = { ...s.land }, R = G.RULES;
  for (let k = s.level[i]; k < level; k++) land[d] = Math.min(R.landMax, Math.max(R.landMin, Math.round((land[d] + R.rise) * 1000) / 1000));
  return G.rentFor({ ...s, land, owner: { ...s.owner, [i]: owner }, level: { ...s.level, [i]: level } }, i, level);
}
// The rent lot i would bring with one more level on it.
export const rentAfterBuild = (s, i) => rentAt(s, i, s.level[i] + 1);

// Who a lot for sale is reckoned for: the person whose turn it is, or else the one person at the table, so its rents
// are what it would earn them, its whole district's bonus included when they own the rest. With nobody to reckon for
// (the townsfolk's turn in a game of several people), as if bought by someone who owns nothing else, so only the
// street's bonus counts.
const buyer = s => {
  if (G.current(s).kind === 'human') return s.turn;
  const people = s.players.flatMap((pl, p) => (pl.kind === 'human' ? [p] : []));
  return people.length === 1 ? people[0] : s.players.length;
};

export function rentTable(s, i) {
  const sp = SPACES[i], cur = s.level[i];
  if (sp.type === 'depot') {
    return `<table class="facts"><tr><td>Rent with one depot</td><td>${money(G.RULES.depotRent[1])}</td></tr><tr><td>Rent with both</td><td>${money(G.RULES.depotRent[2])}</td></tr></table>`;
  }
  const o = s.owner[i], to = o >= 0 ? o : buyer(s);
  const rows = G.LEVEL_NAMES.map((name, lv) => `<tr class="${o >= 0 && lv === cur ? 'here' : ''}"><td>Rent, ${name.toLowerCase()}${lv ? ` (+${money(G.buildCost(i))})` : ''}</td><td>${money(rentAt(s, i, lv, to))}</td></tr>`).join('');
  return `<table class="facts">${rows}</table>`;
}

// The top of a lot's or a depot's sheet: whose it is, its rent, and how its district stands. With `warn`, a person's
// lot that a rival could force them to sell says so, from the owner's side.
export function lotFacts(s, i, { warn = false } = {}) {
  const sp = SPACES[i], d = sp.district;
  let h = `<div class="kicker">${d ? `${swatch(d)} ${DISTRICT[d].name}` : 'Railway'}</div><h2 id="sheetTitle">${esc(sp.name)}</h2>`;
  const o = s.owner[i], pl = s.players[o];
  h += `<p>${o < 0 ? `For sale at ${money(G.landValue(s, i))}.` : `${esc(Whose(pl))} ${sp.type === 'lot' ? G.LEVEL_NAMES[s.level[i]].toLowerCase() : 'depot'}. Rent is <b>${money(G.rentFor(s, i))}</b>.`}</p>`;
  const price = warn && o >= 0 && pl.kind === 'human' ? G.buyoutPrice(s, i) : null;
  if (price != null) {
    h += `<p class="note warn">A rival who lands here can make ${o === s.turn ? 'you' : esc(who(pl))} sell it for ${money(price)}. ${sp.type === 'depot' ? 'Own both depots to keep it.' : 'Build on it, or own the whole district, to keep it.'}</p>`;
  }
  h += rentTable(s, i);
  if (d) {
    const lots = LOTS_IN[d];
    const owners = lots.map(j => s.owner[j]);
    const built = lots.filter(j => s.level[j] > 0).length;
    h += `<p class="note">Land here is at ${Math.round(s.land[d] * 100)}% of its first price. Every building on ${DISTRICT[d].name} raises the land and adds a quarter to the rent of the lots beside it.`;
    if (o >= 0 && owners.every(x => x === o)) h += ` ${esc(Who(pl))} ${agree(pl, 'own', 'owns')} all of ${DISTRICT[d].name}, so rent is up and blocks can go up.`;
    else h += ` Own all three to build blocks.`;
    if (built) h += ` ${built} of 3 lots built on.`;
    h += '</p>';
  }
  return h;
}

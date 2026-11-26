// Boomtown's words, with no screen: amounts, who's who in a sentence, and the facts on a lot's sheet. app.js and
// view.js write with these, and test/unit.test.mjs reads them in Node.

import { SPACES, DISTRICT, LOTS_IN, DEPOTS } from './board.js';
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

// The rules in words, built from RULES so the text can't fall behind the numbers: How to play, the sheets and the
// board's labels say them the same way.
const R = G.RULES;
export const pct = x => `${Math.round(x * 100)}%`; // a district's land, against its first price: 1.22 is 122%
const share = x => ({ 0.1: 'a tenth', 0.2: 'a fifth', 0.25: 'a quarter', 0.5: 'half' }[x] ?? pct(x));
export const SAYS = {
  street: `each lot with a building on it adds ${pct(R.street)} to the rent of the other lots there, whoever owns them`,
  tax: `${money(R.taxPerLevel)} for every building level you own, and never less than ${money(R.taxMin)}, into the kitty`,
  hall: `its land goes up by ${share(R.hall)} of its first price`,
  // game.js's payday: the interest is a tenth of the loan rounded up to the $5, and never less than $5
  interest: `adds ${share(R.interest)}, rounded up to the next $5 (at least $5), each time you pass Payday`,
  depots: `rent is ${money(R.depotRent[1])}, or ${money(R.depotRent[2])} when one player owns both`,
};
const count = n => ['no', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n);

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

// A row of the Land Office's or the Estate sale's list, for player p to choose from: what empty lot i would rent for
// once theirs (the street's bonus counted, and the whole district's when it finishes one), and where its district (or
// the pair of depots) stands: "Mill Row · rent $5 · Rusty owns 1 of 3", "Finishes your Mill Row · rent $10". The
// sheet is p's own, so p is "you" in it. `finishes`: owning it would make the whole district, or both depots, p's.
// Plain text: escape it for HTML.
export function forSale(s, i, p) {
  const sp = SPACES[i], depot = sp.type === 'depot';
  const others = (depot ? DEPOTS : LOTS_IN[sp.district]).filter(j => j !== i);
  const rent = `rent ${money(rentAt(s, i, 0, p))}`;
  const finishes = others.every(j => s.owner[j] === p);
  if (finishes) return { finishes, line: `${depot ? 'Makes both depots yours' : `Finishes your ${DISTRICT[sp.district].name}`} · ${rent}` };
  const held = new Map();
  for (const j of others) if (s.owner[j] >= 0) held.set(s.owner[j], (held.get(s.owner[j]) || 0) + 1);
  const name = q => (q === p ? 'you' : s.players[q].name), Name = q => (q === p ? 'You' : s.players[q].name);
  let stands;
  if (!held.size) stands = "Nobody's yet";
  else if (depot) stands = `${Name([...held.keys()][0])} has the other`; // not p's: that would finish the pair
  else if (held.size === 1) { const [[q, n]] = held; stands = `${Name(q)} ${q === p ? 'own' : 'owns'} ${n} of 3`; }
  else { const [a, b] = [...held.keys()].sort((x, y) => (y === p) - (x === p)); stands = `${Name(a)} and ${name(b)} own 1 each`; }
  return { finishes, line: `${depot ? 'Railway' : DISTRICT[sp.district].name} · ${rent} · ${stands}` };
}

// The top of a lot's or a depot's sheet: whose it is, its rent, and how its district stands. With `warn`, a person's
// lot that a rival could force them to sell says so, from the owner's side. `under` is HTML to put under the opening
// line (the rent sheet's cash), above the rents.
export function lotFacts(s, i, { warn = false, under = '' } = {}) {
  const sp = SPACES[i], d = sp.district;
  let h = `<div class="kicker">${d ? `${swatch(d)} ${DISTRICT[d].name}` : 'Railway'}</div><h2 id="sheetTitle">${esc(sp.name)}</h2>`;
  const o = s.owner[i], pl = s.players[o];
  h += `<p>${o < 0 ? `For sale at ${money(G.landValue(s, i))}.` : `${esc(Whose(pl))} ${sp.type === 'lot' ? G.LEVEL_NAMES[s.level[i]].toLowerCase() : 'depot'}. Rent is <b>${money(G.rentFor(s, i))}</b>.`}</p>${under}`;
  const price = warn && o >= 0 && pl.kind === 'human' ? G.buyoutPrice(s, i) : null;
  if (price != null) {
    h += `<p class="note warn">A rival who lands here can make ${o === s.turn ? 'you' : esc(who(pl))} sell it for ${money(price)}. ${sp.type === 'depot' ? 'Own both depots to keep it.' : 'Build on it, or own the whole district, to keep it.'}</p>`;
  }
  h += rentTable(s, i);
  if (d) {
    const lots = LOTS_IN[d];
    const owners = lots.map(j => s.owner[j]);
    const built = lots.filter(j => s.level[j] > 0).length;
    h += `<p class="note">Land here is at ${Math.round(s.land[d] * 100)}% of its first price. Every building on ${DISTRICT[d].name} raises the land, and ${SAYS.street}.`;
    if (o >= 0 && owners.every(x => x === o)) h += ` ${esc(Who(pl))} ${agree(pl, 'own', 'owns')} all of ${DISTRICT[d].name}, so rent is up and blocks can go up.`;
    else h += ` Own all three to build blocks.`;
    if (built) h += ` ${built} of 3 lots built on.`;
    h += '</p>';
  }
  return h;
}

// Founders' Day's story, under the headline, from the final standings (G.standings): [the story, one fact from the
// game]. With one person at the table who didn't win, the story is theirs: "You came second, $280 behind Dot." Otherwise
// it's the winner's: "Worth $3,040, $320 ahead of Dot." The fact is the game's biggest rent, when one was paid.
const ORDINAL = ['first', 'second', 'third', 'fourth'];
export function foundersDay(s, st) {
  const [a, b] = st, name = q => s.players[q].name;
  const people = s.players.flatMap((pl, q) => (pl.kind === 'human' ? [q] : []));
  let story;
  if (people.length === 1 && people[0] !== a.p) {
    const k = st.findIndex(x => x.p === people[0]), me = st[k];
    story = `${Who(s.players[me.p])} came ${ORDINAL[k]}, ${me.worth < a.worth ? `${money(a.worth - me.worth)} behind ${name(a.p)}` : `level with ${name(a.p)}, who had more cash in hand`}.`;
  } else {
    const ahead = a.worth > b.worth ? `${money(a.worth - b.worth)} ahead of ${name(b.p)}` : a.cash > b.cash ? `level with ${name(b.p)}, with more cash in hand` : `level with ${name(b.p)}`;
    story = `Worth ${money(a.worth)}, ${ahead}.`;
  }
  const r = s.biggestRent;
  const fact = r ? `Biggest rent: ${Who(s.players[r.from])} paid ${who(s.players[r.to])} ${money(r.amount)} on ${SPACES[r.at].name}, in round ${r.round}.` : '';
  return [story, fact];
}

// Founders' Day as a few lines of text to send through the phone's share sheet, or to paste: the headline, the
// standings and where to play. Read by someone who wasn't at the table, so a person called You goes by their seat
// ("Player 1"), as at a table of several people.
export function shareText(s, st) {
  const name = q => (isYou(s.players[q]) ? `Player ${s.players[q].token + 1}` : s.players[q].name);
  return [`THE BOOMTOWN GAZETTE, Founders' Day (${s.rounds} rounds): ${name(st[0].p)} is the richest in Boomtown.`,
    ...st.map((x, k) => `${k + 1}. ${name(x.p)} ${money(x.worth)}`), 'boomtown.junkdrawer.works'].join('\n');
}

// Records, kept on the device: games finished, games won by a person and the best worth on Founders' Day; how the
// people at the table did against each of the townsfolk ({ mabel: { played, beaten } }); and the last five results,
// newest first ({ date: '2026-11-26', place: 1, of: 4, worth, name }). Read from whatever was saved, which may be an
// older record with only the first three.
const NO_RECORDS = { played: 0, won: 0, best: 0 };
export const readRecords = (r = {}) => ({
  ...NO_RECORDS, ...r, vs: Object.fromEntries(Object.entries(r?.vs || {}).map(([id, v]) => [id, { ...v }])), last: [...(r?.last || [])],
});
// The record with a finished game added (G.standings for `st`, the local date as 'YYYY-MM-DD'). The townsfolk are
// beaten when the best-placed person finishes above them; a result is that person's place and worth, with their name
// when more than one person played.
export function addGame(saved, s, st, date) {
  const r = readRecords(saved);
  const k = st.findIndex(x => s.players[x.p].kind === 'human');
  if (k < 0) return r;
  r.played++;
  if (k === 0) r.won++;
  for (const x of st) if (s.players[x.p].kind === 'human') r.best = Math.max(r.best, x.worth);
  st.forEach((x, j) => {
    const pl = s.players[x.p];
    if (pl.kind !== 'bot') return;
    const v = (r.vs[pl.bot] ||= { played: 0, beaten: 0 });
    v.played++;
    if (k < j) v.beaten++;
  });
  const people = s.players.filter(pl => pl.kind === 'human').length;
  r.last = [{ date, place: k + 1, of: st.length, worth: st[k].worth, ...(people > 1 ? { name: s.players[st[k].p].name } : {}) }, ...r.last].slice(0, 5);
  return r;
}
const PLACE = ['1st', '2nd', '3rd', '4th'];
// A saved date as the Gazette would print it: 'Nov 26', with the year when it isn't this one.
const shortDate = (date, now) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y !== now.getFullYear() ? { year: 'numeric' } : {}) });
};
// The Records sheet: the three numbers, then the townsfolk's tally and the last five results as the Gazette's almanac.
// `names`: the townsfolk's names by id.
export function recordsHtml(saved, names, now = new Date()) {
  const r = readRecords(saved);
  let h = `<h2 id="sheetTitle">Records</h2>
    <table class="facts"><tr><td>Games finished</td><td>${r.played}</td></tr><tr><td>Won by a person</td><td>${r.won}</td></tr>
    <tr><td>Best worth on Founders' Day</td><td>${r.best ? money(r.best) : '—'}</td></tr></table>`;
  const vs = Object.keys(names).filter(id => r.vs[id]?.played);
  if (vs.length) {
    h += `<div class="almanac"><h3>Against the townsfolk</h3><ul>${vs.map(id => {
      const { played, beaten } = r.vs[id];
      return `<li><span>Beat ${esc(names[id])}</span><i></i><span>${beaten} ${beaten === 1 ? 'time' : 'times'} in ${played}</span></li>`;
    }).join('')}</ul></div>`;
  }
  if (r.last.length) {
    h += `<div class="almanac"><h3>${r.last.length === 1 ? 'The last game' : `The last ${count(r.last.length)} games`}</h3><ul>${r.last.map(g =>
      `<li><span>${shortDate(g.date, now)}${g.name ? `, ${esc(g.name)}` : ''}</span><i></i><span>${PLACE[g.place - 1]} of ${g.of} · ${money(g.worth)}</span></li>`).join('')}</ul></div>`;
  }
  return h;
}

// How to play.
export function rulesHtml() {
  return `<div class="rules"><h2 id="sheetTitle">How to play</h2>
    <p>Boomtown is a town that isn't built yet. Go round the board buying lots and building on them. When the last round ends it's Founders' Day, and whoever is worth the most wins: cash, plus land, plus buildings, less any loan.</p>
    <h3>Your turn</h3>
    <ul>
      <li><b>Roll two dice and move by both.</b> Or take a <b>detour</b> and move by just one of them. You start with ${count(R.detours)} detours and can hold ${count(R.detourMax)}; passing Payday gives one back.</li>
      <li><b>Land on a lot for sale</b> and you can buy it.</li>
      <li><b>Land on someone else's lot</b> and you pay them rent. If nothing is built on it and they don't own the whole district, you can make them sell it to you instead, for ${R.buyout} times the land value.</li>
      <li><b>Then build</b> on any of your lots: a house, then a shop, then a block. A block needs all three lots in the district.</li>
      <li><b>Whoever goes later starts with a little more:</b> ${money(R.seatBonus)} for each seat after the first. Play again moves who goes first one seat round the table.</li>
    </ul>
    <h3>How the town grows</h3>
    <ul>
      <li><b>Every building lifts the street.</b> It raises the land value of its whole district, and ${SAYS.street}.</li>
      <li><b>Own a whole district</b> and its rents go up: double on empty lots, and half as much again on built ones.</li>
      <li><b>The Gazette</b> brings news: a district booms or busts, a fair pays out, the pipes burst. An <b>estate sale</b> lets you buy any empty lot at half price.</li>
    </ul>
    <h3>The corners</h3>
    <ul>
      <li><b>Payday:</b> ${money(R.salary)} as you pass, ${money(R.salary + R.landBonus)} if you land on it.</li>
      <li><b>Land Office:</b> buy any empty lot in town.</li>
      <li><b>Town Square:</b> take the kitty, where fines and taxes collect.</li>
      <li><b>City Hall:</b> rezone a district: ${SAYS.hall}, and its rents with it.</li>
    </ul>
    <h3>Round the board</h3>
    <ul>
      <li><b>Lumberyard:</b> build one level on one of your lots at half price.</li>
      <li><b>Assessor:</b> pay ${SAYS.tax}.</li>
      <li><b>Depots:</b> ${SAYS.depots}. Nobody can make you sell a depot while you own both.</li>
    </ul>
    <h3>Running short</h3>
    <ul>
      <li><b>Nobody goes out.</b> If you can't pay, the bank lends you the rest and ${SAYS.interest}. Money coming in pays it off first. You can sell buildings back for half what they cost.</li>
    </ul>
    <p class="note">A tap on a space shows it, and a tap on a player's card shows what they own, even while the townsfolk play. A tap on the middle of the board hurries the townsfolk along.</p></div>`;
}

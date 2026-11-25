// The board on screen: one SVG drawn from the game state, with the pieces moved and the little flourishes
// (money floating up, a building going up) animated over it.

import { SPACES, DISTRICT, N, cellRect, SIZE } from './board.js';
import { landValue, rentFor, LEVEL_NAMES } from './game.js';
import * as art from './art.js';

const NS = 'http://www.w3.org/2000/svg';
const TOKEN_SCALE = 1.35;

// The board's height in board units: 900 makes it square; more makes it tall, for a phone held upright.
let H = SIZE;

// Where the drawing, its tag, the pieces, the district band and a move's number badge go in each cell.
function layout(i) {
  const r = cellRect(i, H);
  const { x, y, w, h, side } = r;
  const roomy = h >= 140; // side cells on a tall board have room for a full-size drawing
  switch (side) {
    case 'bottom': return { r, band: [x, y, w, 20], art: [x + w / 2, y + 76, 0.86], tag: [x + w / 2, y + 128], tok: [x + w / 2, y + 72], badge: [x + 24, y + 44] };
    case 'top': return { r, band: [x, y + h - 20, w, 20], art: [x + w / 2, y + 58, 0.86], tag: [x + w / 2, y + 110], tok: [x + w / 2, y + 60], badge: [x + 24, y + 24] };
    case 'left': return roomy
      ? { r, band: [x + w - 20, y, 20, h], art: [x + 65, y + h * 0.43, 0.86], tag: [x + 65, y + h - 24], tok: [x + 65, y + h * 0.45], badge: [x + 24, y + 24] }
      : { r, band: [x + w - 20, y, 20, h], art: [x + 62, y + 40, 0.62], tag: [x + 62, y + 82], tok: [x + 62, y + 46], badge: [x + 22, y + 22] };
    case 'right': return roomy
      ? { r, band: [x, y, 20, h], art: [x + 85, y + h * 0.43, 0.86], tag: [x + 85, y + h - 24], tok: [x + 85, y + h * 0.45], badge: [x + w - 24, y + 24] }
      : { r, band: [x, y, 20, h], art: [x + 88, y + 40, 0.62], tag: [x + 88, y + 82], tok: [x + 88, y + 46], badge: [x + w - 22, y + 22] };
    default: return { r, band: null, art: [x + w / 2, y + 60, 1.0], tag: [x + w / 2, y + 128], tok: [x + w / 2, y + 66], badge: [x + 26, y + 26] };
  }
}

const CORNER_LABEL = { payday: 'PAYDAY', office: 'LAND OFFICE', square: 'TOWN SQUARE', hall: 'CITY HALL' };

export function createBoard(svg, { onCell } = {}) {
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${H}`);
  svg.innerHTML = `
    <defs>
      <pattern id="paper" width="12" height="12" patternUnits="userSpaceOnUse">
        <rect width="12" height="12" fill="${art.PAPER}"/><circle cx="3" cy="4" r=".7" fill="#0000000d"/><circle cx="9" cy="10" r=".6" fill="#0000000a"/>
      </pattern>
    </defs>
    <rect class="paper" x="0" y="0" width="${SIZE}" height="${H}" fill="url(#paper)"/>
    <g class="cells"></g>
    <g class="frame"></g>
    <g class="marks"></g>
    <g class="tokens"></g>
    <g class="fx"></g>`;
  const cellsG = svg.querySelector('.cells'), marksG = svg.querySelector('.marks');
  const tokensG = svg.querySelector('.tokens'), fxG = svg.querySelector('.fx');
  const cells = [];
  for (let i = 0; i < N; i++) {
    const g = document.createElementNS(NS, 'g');
    g.classList.add('cell');
    g.dataset.i = i;
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.addEventListener('click', () => onCell?.(i));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCell?.(i); } });
    cellsG.appendChild(g);
    cells.push(g);
  }

  const view = { svg, shown: [], tokenEls: [], last: null };

  const drawFrame = () => {
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${H}`);
    svg.querySelector('.paper').setAttribute('height', H);
    svg.querySelector('.frame').innerHTML = `
      <rect x="150" y="150" width="600" height="${H - 300}" fill="none" stroke="${art.INK}" stroke-width="3"/>
      <rect x="1.5" y="1.5" width="${SIZE - 3}" height="${H - 3}" fill="none" stroke="${art.INK}" stroke-width="3"/>`;
  };
  drawFrame();

  // Square (900) or tall: redraw everything for the new shape.
  view.setHeight = h => {
    if (h === H) return;
    H = h;
    drawFrame();
    cells.forEach(g => { g._h = null; });
    if (view.last) view.render(view.last, view.lastMarks);
  };
  view.height = () => H;

  view.cellCenter = i => { const L = layout(i); return L.tok; };

  function tokenPos(p, at, players) {
    const here = players.map((pl, q) => ({ q, at: q === p ? at : view.shown[q] })).filter(o => o.at === at).map(o => o.q);
    const k = here.indexOf(p), n = here.length;
    const [cx, cy] = layout(at).tok;
    const offs = n <= 1 ? [[0, 0]] : n === 2 ? [[-17, 0], [17, 0]] : [[-17, -14], [17, -14], [-17, 14], [17, 14]];
    const [dx, dy] = offs[Math.max(0, k)] || [0, 0];
    return [cx + dx, cy + dy];
  }

  view.render = (s, { dests = [], buildable = [], focus = null, labels = {} } = {}) => {
    view.last = s;
    view.lastMarks = { dests, buildable, focus, labels };
    for (let i = 0; i < N; i++) drawCell(cells[i], i, s, labels);
    // Pieces: keep their shown spot (an animation may be part way); a new game puts them at their real spot.
    s.players.forEach((pl, p) => {
      if (view.shown[p] == null || view.shown.length !== s.players.length) view.shown[p] = pl.pos;
      let el = view.tokenEls[p];
      if (!el) {
        el = document.createElementNS(NS, 'g');
        el.classList.add('tok');
        el.innerHTML = `<g class="lift"><g transform="scale(${TOKEN_SCALE})">${art.token(pl.token)}</g></g>`;
        tokensG.appendChild(el);
        view.tokenEls[p] = el;
      }
      el.classList.toggle('now', p === s.turn && s.phase !== 'over');
    });
    while (view.tokenEls.length > s.players.length) view.tokenEls.pop().remove();
    view.placeTokens(s);
    // Destination badges and build badges.
    let m = '';
    for (const d of dests) {
      const L = layout(d.to), r = L.r;
      m += `<g class="dest${d.usable === false ? ' off' : ''}" data-i="${d.to}">
        <rect x="${r.x + 4}" y="${r.y + 4}" width="${r.w - 8}" height="${r.h - 8}" rx="8"/>
        <g transform="translate(${L.badge[0]} ${L.badge[1]})"><circle r="19"/><text y="7">${d.label}</text></g></g>`;
    }
    for (const i of buildable) {
      const L = layout(i), r = L.r;
      const bx = r.side === 'right' ? r.x + 38 : r.x + r.w - (r.side === 'left' ? 38 : 18);
      const by = r.side === 'bottom' ? r.y + 40 : r.y + 18;
      m += `<g class="can-build" transform="translate(${bx} ${by})"><circle r="13"/><path d="M-6 0 H6 M0 -6 V6"/></g>`;
    }
    if (focus != null) {
      const r = cellRect(focus, H);
      m += `<rect class="focus-ring" x="${r.x + 3}" y="${r.y + 3}" width="${r.w - 6}" height="${r.h - 6}" rx="6"/>`;
    }
    marksG.innerHTML = m;
  };

  view.placeTokens = s => {
    s.players.forEach((pl, p) => {
      const [x, y] = tokenPos(p, view.shown[p], s.players);
      view.tokenEls[p].style.transform = `translate(${x}px, ${y}px)`;
    });
  };

  function drawCell(g, i, s, labels) {
    const sp = SPACES[i], L = layout(i), { r } = L;
    const o = s.owner[i] ?? -1, color = o >= 0 ? art.PLAYER_COLORS[s.players[o].token] : null;
    let h = `<rect class="bg" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="transparent" stroke="${art.INK}" stroke-width="2"/>`;
    if (L.band && sp.district) h += `<rect x="${L.band[0]}" y="${L.band[1]}" width="${L.band[2]}" height="${L.band[3]}" fill="${DISTRICT[sp.district].color}" stroke="${art.INK}" stroke-width="2"/>`;
    let drawing = '', tag = '', label = '';
    switch (sp.type) {
      case 'lot': {
        const lv = s.level[i];
        drawing = o < 0 ? art.forSale() : lv ? art.BUILDINGS[lv](color) : art.sold(color);
        tag = o >= 0 ? pill(`$${rentFor(s, i)}`, color) : pill(`$${landValue(s, i)}`, '#fffaf0', art.INK);
        label = `${sp.name}, ${DISTRICT[sp.district].name}. ` + (o < 0 ? `For sale, $${landValue(s, i)}.` : `${s.players[o].name}'s ${LEVEL_NAMES[lv].toLowerCase()}, rent $${rentFor(s, i)}.`);
        break;
      }
      case 'depot':
        drawing = art.depot(color);
        tag = o >= 0 ? pill(`$${rentFor(s, i)}`, color) : pill(`$${sp.price}`, '#fffaf0', art.INK);
        label = `${sp.name}. ` + (o < 0 ? `For sale, $${sp.price}.` : `${s.players[o].name}'s, rent $${rentFor(s, i)}.`);
        break;
      case 'gazette': drawing = art.gazette; label = 'The Gazette: draw a headline.'; break;
      case 'yard': drawing = art.lumber; tag = `<text class="tiny">BUILD ½</text>`; label = 'Lumberyard: build one level at half price.'; break;
      case 'tax': drawing = art.assessor; label = 'Assessor: pay for every building level you own.'; break;
      case 'payday': drawing = art.payday; label = 'Payday.'; break;
      case 'office': drawing = art.office; label = 'Land Office: buy any empty lot.'; break;
      case 'square': drawing = art.square; label = `Town Square: take the kitty, $${s.kitty}.`; break;
      case 'hall': drawing = art.hall; label = 'City Hall: rezone a district.'; break;
    }
    h += `<g transform="translate(${L.art[0]} ${L.art[1]}) scale(${L.art[2]})">${drawing}</g>`;
    if (r.side === 'corner') {
      const sub = sp.type === 'payday' ? 'COLLECT $150' : sp.type === 'square' ? `KITTY $${s.kitty}` : '';
      h += `<text class="corner-label" x="${r.x + r.w / 2}" y="${r.y + 122}">${CORNER_LABEL[sp.type]}</text>`;
      if (sub) h += `<text class="corner-sub" x="${r.x + r.w / 2}" y="${r.y + 140}">${sub}</text>`;
      if (sp.type === 'payday') h += `<path class="arrow" d="M${r.x + 36} ${r.y + 56} h-24 m8 -7 l-8 7 l8 7"/>`;
    } else if (tag) h += `<g transform="translate(${L.tag[0]} ${L.tag[1]})">${tag}</g>`;
    if (labels[i]) label += ' ' + labels[i];
    if (g._h !== h) { g.innerHTML = h; g._h = h; }
    g.setAttribute('aria-label', label);
  }

  const pill = (text, fill, ink = '#fff') => {
    const w = 14 + text.length * 12.5;
    return `<rect x="${-w / 2}" y="-14" width="${w}" height="26" rx="13" fill="${fill}" stroke="${art.INK}" stroke-width="2"/>
      <text class="pill" y="6" fill="${ink}">${text}</text>`;
  };

  // Hop a piece along a path of spaces.
  view.animateMove = async (s, p, path, msPerStep = 140) => {
    const el = view.tokenEls[p];
    if (!el) return;
    for (const at of path) {
      const [x0, y0] = tokenPos(p, view.shown[p], s.players);
      view.shown[p] = at;
      const [x1, y1] = tokenPos(p, at, s.players);
      if (msPerStep > 0) {
        const lift = el.querySelector('.lift');
        lift.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-22px)' }, { transform: 'translateY(0)' }], { duration: msPerStep, easing: 'ease-out' });
        await el.animate([{ transform: `translate(${x0}px, ${y0}px)` }, { transform: `translate(${x1}px, ${y1}px)` }], { duration: msPerStep, easing: 'ease-in-out' }).finished;
      }
      el.style.transform = `translate(${x1}px, ${y1}px)`;
    }
    view.placeTokens(s);
  };

  view.jump = (s, p, at) => { view.shown[p] = at; view.placeTokens(s); };

  // A few words floating up off a space: money in or out.
  view.float = (i, text, color = art.INK, ms = 1300) => {
    const [x, y] = layout(i).tok;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'float');
    t.setAttribute('x', x); t.setAttribute('y', y - 20);
    t.setAttribute('fill', color);
    t.textContent = text;
    fxG.appendChild(t);
    t.animate([{ transform: 'translateY(0)', opacity: 0 }, { transform: 'translateY(-14px)', opacity: 1, offset: 0.15 }, { transform: 'translateY(-60px)', opacity: 0 }], { duration: ms, easing: 'ease-out' })
      .finished.then(() => t.remove(), () => t.remove());
  };

  // A building going up, or a lot changing hands: give the cell a little bounce.
  view.pop = i => {
    const g = cells[i];
    g.classList.remove('pop');
    void g.getBBox();
    g.classList.add('pop');
    setTimeout(() => g.classList.remove('pop'), 600);
  };

  view.reset = () => { view.shown = []; view.tokenEls.forEach(el => el.remove()); view.tokenEls = []; };
  return view;
}

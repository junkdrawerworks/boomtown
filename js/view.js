// The board on screen: one SVG drawn from the game state, with the pieces moved and the little flourishes
// (money floating up, a building going up) animated over it.

import { SPACES, DISTRICT, N, cellRect, SIZE } from './board.js';
import { landValue, rentFor, LEVEL_NAMES, RULES } from './game.js';
import * as art from './art.js';
import { Whose, SAYS } from './words.js';

const NS = 'http://www.w3.org/2000/svg';
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches; // the person asked for less motion
const TOKEN_SCALE = 1.35, TOKEN_R = 17.5; // a piece alone is drawn 1.35 times its size; it reaches 17.5 from its middle
const usd = n => `$${n.toLocaleString('en-US')}`; // as money() in app.js writes it

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

// onCell(i): a space was tapped (or Enter pressed on it). onDest(i): a space a move can reach, marked on the board, was
// tapped: the whole space if the move can be made, or its number badge either way.
export function createBoard(svg, { onCell, onDest } = {}) {
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
    <g class="marks" aria-hidden="true"></g>
    <g class="tokens" aria-hidden="true"></g>
    <g class="marks-top" aria-hidden="true"></g>
    <g class="kbd" aria-hidden="true"></g>
    <g class="fx" aria-hidden="true"></g>`;
  // Layers, bottom up: the spaces, the frame, a move's outline and build badges, the pieces, a move's number badge (over
  // the pieces, so it's never hidden under them), the keyboard's ring, and the flourishes. The spaces' own labels say
  // who's on them and where a move lands (see drawCell), so the layers over them are hidden from screen readers: they'd
  // only add stray numbers.
  const cellsG = svg.querySelector('.cells'), marksG = svg.querySelector('.marks'), topG = svg.querySelector('.marks-top');
  const tokensG = svg.querySelector('.tokens'), kbdG = svg.querySelector('.kbd'), fxG = svg.querySelector('.fx');
  const cells = [];
  // The keyboard's ring on a space is drawn in its own layer over the frame and the pieces, which would cover most of
  // a ring drawn on the space itself.
  let kbdAt = null; // the space the keyboard is on, ringed while the ring would show (:focus-visible)
  const drawKbd = () => {
    if (kbdAt == null) { kbdG.innerHTML = ''; return; }
    const r = cellRect(kbdAt, H), box = `x="${r.x + 6}" y="${r.y + 6}" width="${r.w - 12}" height="${r.h - 12}" rx="6"`;
    kbdG.innerHTML = `<rect class="ink" ${box}/><rect class="gold" ${box}/>`;
  };
  // A move's space, while the move can be made, makes it; any other space opens its sheet.
  const tap = i => {
    if (onDest && view.lastMarks?.dests.some(d => d.to === i && d.usable !== false)) onDest(i);
    else onCell?.(i);
  };
  for (let i = 0; i < N; i++) {
    const g = document.createElementNS(NS, 'g');
    g.classList.add('cell');
    g.dataset.i = i;
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.addEventListener('click', () => tap(i));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(i); } });
    g.addEventListener('focus', () => { if (g.matches(':focus-visible') && !document.documentElement.classList.contains('tapped')) { kbdAt = i; drawKbd(); } });
    g.addEventListener('blur', () => { if (kbdAt === i) { kbdAt = null; drawKbd(); } });
    cellsG.appendChild(g);
    cells.push(g);
  }
  topG.addEventListener('click', e => {
    const b = e.target.closest('.badge');
    if (b) onDest?.(+b.dataset.i);
  });

  const view = { svg, shown: [], tokenEls: [], last: null };

  const drawFrame = () => {
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${H}`);
    svg.classList.toggle('tall', H > SIZE); // drawn smaller on screen, so its text is set bigger
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

  // Where piece p goes on space `at`, and how big: [x, y, scale]. Pieces sharing a space are drawn smaller, side by side
  // or two by two, touching but not overlapping, so the drawing still shows between them. The stack keeps clear of the
  // price or rent tag, moving up on the short spaces down the sides of the square board to do so.
  function tokenPos(p, at, players) {
    const here = players.map((pl, q) => ({ q, at: q === p ? at : view.shown[q] })).filter(o => o.at === at).map(o => o.q);
    const k = here.indexOf(p), n = here.length;
    const L = layout(at), scale = n <= 1 ? TOKEN_SCALE : n === 2 ? 1.15 : 1;
    const R = TOKEN_R * scale; // a piece's reach from its middle, outline and all
    const offs = n <= 1 ? [[0, 0]] : n === 2 ? [[-R, 0], [R, 0]] : [[-17, -16], [17, -16], [-17, 16], [17, 16]];
    const [dx, dy] = offs[Math.max(0, k)] || [0, 0];
    let [cx, cy] = L.tok;
    if (L.r.side !== 'corner') {
      const tagTop = L.tag[1] - (H > SIZE ? 17 : 14), reach = (n >= 3 ? 16 : 0) + R;
      cy = Math.max(L.r.y + reach, Math.min(cy, tagTop - 1 - reach));
    }
    return [cx + dx, cy + dy, scale];
  }
  // Place a piece's group, and size the drawing inside it.
  const putToken = (el, [x, y, scale]) => {
    el.style.transform = `translate(${x}px, ${y}px)`;
    const g = el.querySelector('.size');
    if (g._scale !== scale) { g.setAttribute('transform', `scale(${scale})`); g._scale = scale; }
  };

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
        el.innerHTML = `<g class="lift"><g class="size" transform="scale(${TOKEN_SCALE})">${art.token(pl.token)}</g></g>`;
        tokensG.appendChild(el);
        view.tokenEls[p] = el;
      }
      el.classList.toggle('now', p === s.turn && s.phase !== 'over');
    });
    while (view.tokenEls.length > s.players.length) view.tokenEls.pop().remove();
    // The piece whose turn it is goes on top of any it shares a space with (moved only when it isn't already last: a
    // moved piece starts its bob again).
    const now = s.phase !== 'over' && view.tokenEls[s.turn];
    if (now && tokensG.lastElementChild !== now) tokensG.appendChild(now);
    view.placeTokens(s);
    // Destination badges and build badges.
    // The tall board is drawn smaller on a phone, so its badges are bigger, and sit a little further in.
    const big = H > SIZE, R = big ? 24 : 19, B = big ? 17 : 13, inset = big ? 5 : 0;
    // A move by both dice has a brick badge, as its button is; a detour's is gold; one that can't be made is grey.
    let m = '', top = '';
    for (const d of dests) {
      const L = layout(d.to), r = L.r;
      const bx = L.badge[0] + (L.badge[0] < r.x + r.w / 2 ? inset : -inset), by = L.badge[1] + inset;
      const cls = (d.usable === false ? ' off' : '') + (d.detour ? '' : ' both');
      m += `<g class="dest${cls}" data-i="${d.to}"><rect x="${r.x + 4}" y="${r.y + 4}" width="${r.w - 8}" height="${r.h - 8}" rx="8"/></g>`;
      top += `<g class="badge${cls}" data-i="${d.to}" transform="translate(${bx} ${by})"><circle r="${R}"/><text y="${big ? 10 : 7}">${d.label}</text></g>`;
    }
    for (const i of buildable) {
      const L = layout(i), r = L.r;
      const bx = r.side === 'right' ? r.x + 38 : r.x + r.w - (r.side === 'left' ? 38 : 18 + inset);
      const by = (r.side === 'bottom' ? r.y + 40 : r.y + 18) + inset;
      const k = Math.round(B * 6 / 13);
      // Placed by the outer group: the badge's breathing animation sets a CSS transform, which would replace this one.
      m += `<g transform="translate(${bx} ${by})"><g class="can-build"><circle r="${B}"/><path d="M${-k} 0 H${k} M0 ${-k} V${k}"/></g></g>`;
    }
    if (focus != null) {
      const r = cellRect(focus, H);
      m += `<rect class="focus-ring" x="${r.x + 3}" y="${r.y + 3}" width="${r.w - 6}" height="${r.h - 6}" rx="6"/>`;
    }
    marksG.innerHTML = m;
    topG.innerHTML = top;
    drawKbd(); // the board may have changed shape
  };

  // Ring one space (or none) without changing the other marks.
  view.focus = i => { if (view.last) view.render(view.last, { ...view.lastMarks, focus: i }); };

  view.placeTokens = s => {
    s.players.forEach((pl, p) => putToken(view.tokenEls[p], tokenPos(p, view.shown[p], s.players)));
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
        tag = o >= 0 ? pill(usd(rentFor(s, i)), art.tagColor(color), r.w, '#fff', s.players[o].token) : pill(usd(landValue(s, i)), '#fffaf0', r.w, art.INK);
        label = `${sp.name}, ${DISTRICT[sp.district].name}. ` + (o < 0 ? `For sale, ${usd(landValue(s, i))}.` : `${Whose(s.players[o])} ${LEVEL_NAMES[lv].toLowerCase()}, rent ${usd(rentFor(s, i))}.`);
        break;
      }
      case 'depot':
        drawing = art.depot(color);
        tag = o >= 0 ? pill(usd(rentFor(s, i)), art.tagColor(color), r.w, '#fff', s.players[o].token) : pill(usd(sp.price), '#fffaf0', r.w, art.INK);
        label = `${sp.name}. ` + (o < 0 ? `For sale, ${usd(sp.price)}.` : `${Whose(s.players[o])} depot, rent ${usd(rentFor(s, i))}.`);
        break;
      case 'gazette': drawing = art.gazette; tag = `<text class="tiny">NEWS</text>`; label = 'The Gazette: draw a headline.'; break;
      case 'yard': drawing = art.lumber; tag = `<text class="tiny">BUILD ½</text>`; label = 'Lumberyard: build one level at half price.'; break;
      case 'tax': drawing = art.assessor; tag = `<text class="tiny">TAX</text>`; label = `Assessor: pay ${SAYS.tax}.`; break;
      case 'payday': drawing = art.payday; label = `Payday: collect ${usd(RULES.salary)} passing, ${usd(RULES.salary + RULES.landBonus)} landing.`; break;
      case 'office': drawing = art.office; label = 'Land Office: buy any empty lot.'; break;
      case 'square': drawing = art.square; label = `Town Square: take the kitty, ${usd(s.kitty)}.`; break;
      case 'hall': drawing = art.hall; label = 'City Hall: rezone a district.'; break;
    }
    h += `<g transform="translate(${L.art[0]} ${L.art[1]}) scale(${L.art[2]})">${drawing}</g>`;
    if (r.side === 'corner') {
      const sub = sp.type === 'payday' ? (H > SIZE ? usd(RULES.salary) : `COLLECT ${usd(RULES.salary)}`) : sp.type === 'square' ? `KITTY ${usd(s.kitty)}` : '';
      h += `<text class="corner-label" x="${r.x + r.w / 2}" y="${r.y + 122}">${CORNER_LABEL[sp.type]}</text>`;
      if (sub) h += `<text class="corner-sub" x="${r.x + r.w / 2}" y="${r.y + (H > SIZE ? 142 : 140)}">${sub}</text>`;
      if (sp.type === 'payday') h += `<path class="arrow" d="M${r.x + 36} ${r.y + 56} h-24 m8 -7 l-8 7 l8 7"/>`;
    } else if (tag) h += `<g transform="translate(${L.tag[0]} ${L.tag[1]})">${tag}</g>`;
    const here = s.players.filter(pl => pl.pos === i).map(pl => pl.name);
    if (here.length) label += ` Here: ${here.join(', ')}.`;
    if (labels[i]) label += ' ' + labels[i];
    if (g._h !== h) { g.innerHTML = h; g._h = h; }
    g.setAttribute('aria-label', label);
  }

  // A price or rent tag, sized to its text: 26 units on the tall board (22 on the square one), smaller for a long
  // amount so the tag stays inside its cell (`room` units wide). In the slab face a digit or $ is about .69 em wide, a
  // comma .25. A rent tag carries a little paper copy of the owner's piece at its left end, so who owns a lot shows by
  // shape as well as colour: [2] piece [2] amount [6], the piece as tall as the tag less 7.
  const pill = (text, fill, room, ink = '#fff', piece = null) => {
    const ems = [...text].reduce((n, c) => n + (c === ',' ? 0.25 : 0.69), 0);
    const size = Math.min(H > SIZE ? 26 : 22, piece == null ? Math.floor((room - 16) / ems) : Math.floor((room - 5) / (ems + 1.18)));
    const h = Math.round(size * 1.18), d = h - 7;
    const lead = piece == null ? 7 : d + 4, w = Math.round(ems * size + lead + (piece == null ? 7 : 6));
    const tx = -w / 2 + lead + ems * size / 2;
    return `<rect x="${-w / 2}" y="${-h / 2 - 1}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${art.INK}" stroke-width="2"/>
      <text class="pill" x="${Math.round(tx)}" y="${Math.round(size * 0.36) - 1}" fill="${ink}" style="font-size:${size}px">${text}</text>` +
      (piece == null ? '' : `<g class="owner" transform="translate(${Math.round(-w / 2 + 2 + d / 2)} -1) scale(${(d / 37).toFixed(3)})">${art.token(piece, '#fffaf0')}</g>`);
  };

  // Hop a piece along a path of spaces. Once `hurry()` says so, it jumps the rest of the way (see rush()).
  let hopping = [];
  view.animateMove = async (s, p, path, msPerStep = 140, hurry = () => false) => {
    const el = view.tokenEls[p];
    if (!el) return;
    for (const at of path) {
      const [x0, y0] = tokenPos(p, view.shown[p], s.players);
      view.shown[p] = at;
      const to = tokenPos(p, at, s.players), [x1, y1] = to;
      if (msPerStep > 0 && !hurry()) {
        const lift = el.querySelector('.lift');
        hopping = [
          lift.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-22px)' }, { transform: 'translateY(0)' }], { duration: msPerStep, easing: 'ease-out' }),
          el.animate([{ transform: `translate(${x0}px, ${y0}px)` }, { transform: `translate(${x1}px, ${y1}px)` }], { duration: msPerStep, easing: 'ease-in-out' }),
        ];
        await hopping[1].finished;
        hopping = [];
      }
      putToken(el, to);
    }
    view.placeTokens(s);
  };
  // Cut short the hop under way: the piece goes on by jumping.
  view.rush = () => hopping.forEach(a => a.finish());

  view.jump = (s, p, at) => { view.shown[p] = at; view.placeTokens(s); };

  // A few words floating up off a space: money in or out. Near the top edge (the top row and its corners) there's no
  // room above, so they start below the piece and drift down instead.
  // `size` is '' for money, 'small' for a district's land moving, 'big' for a huge rent.
  view.float = (i, text, color = art.INK, ms = 1300, size = '') => {
    const [x, y] = layout(i).tok;
    const down = y < 120, dir = (down ? 1 : -1) * (calm() ? 0.2 : 1);
    if (calm()) ms = Math.min(ms, 700);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', `float ${size}`.trim());
    t.setAttribute('x', x); t.setAttribute('y', down ? y + 44 : y - 20);
    t.setAttribute('fill', color);
    t.textContent = text;
    fxG.appendChild(t);
    t.animate([{ transform: 'translateY(0)', opacity: 0 }, { transform: `translateY(${14 * dir}px)`, opacity: 1, offset: 0.15 }, { transform: `translateY(${60 * dir}px)`, opacity: 0 }], { duration: ms, easing: 'ease-out' })
      .finished.then(() => t.remove(), () => t.remove());
  };

  // A forced sale: SOLD stamped across the lot in red, which fades after a moment.
  view.stamp = (i, ms = 1700) => {
    const r = cellRect(i, H), g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'stamp');
    g.setAttribute('transform', `translate(${r.x + r.w / 2} ${r.y + r.h / 2}) rotate(-14)`);
    g.innerHTML = '<g class="ink"><rect x="-50" y="-23" width="100" height="46" rx="6"/><text y="11">SOLD</text></g>';
    fxG.appendChild(g);
    const steps = calm() ? [{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
      : [{ transform: 'scale(1.9)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.1 }, { transform: 'scale(1)', opacity: 1, offset: 0.85 }, { opacity: 0 }];
    g.firstChild.animate(steps, { duration: ms, easing: 'ease-out' }).finished.then(() => g.remove(), () => g.remove());
  };

  // A building going up, or a lot changing hands: give the cell a little bounce. It lifts like a card off the board:
  // drawn over the other spaces and the frame, on paper (see .cell.pop in the css), so its lines don't sit beside
  // theirs. Then it goes back in its place, which keeps the spaces in order for the keyboard.
  const popping = new Set();
  view.pop = i => {
    const g = cells[i], had = document.activeElement === g;
    clearTimeout(g._pop);
    g.classList.remove('pop');
    if (!popping.has(g)) { popping.add(g); svg.insertBefore(g, marksG); }
    if (had) g.focus({ preventScroll: true });
    void g.getBBox();
    g.classList.add('pop');
    g._pop = setTimeout(() => {
      g.classList.remove('pop');
      popping.delete(g);
      const has = document.activeElement === g;
      cellsG.insertBefore(g, cells.slice(i + 1).find(c => !popping.has(c)) ?? null);
      if (has) g.focus({ preventScroll: true });
    }, 600);
  };

  view.reset = () => { view.shown = []; view.tokenEls.forEach(el => el.remove()); view.tokenEls = []; };
  return view;
}

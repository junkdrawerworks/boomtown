// Little drawings for the board, as SVG strings. Each is drawn round (0, 0) with the ground at y = 30, in about an
// 80 x 80 box, and is placed and scaled by the board view.

export const INK = '#2a2420';
export const PAPER = '#f3e9cf';
export const PLAYER_COLORS = ['#dd4a2f', '#2d63cf', '#1f9658', '#de4f8d'];
// A player's colour a fifth of the way to ink, for their rent tags on the board and their rents written on paper: white
// on it, or it on the cream paper, reads at 4.5:1 or better.
export const tagColor = hex => '#' + [1, 3, 5].map(k => Math.round(parseInt(hex.slice(k, k + 2), 16) * 0.8 + parseInt(INK.slice(k, k + 2), 16) * 0.2).toString(16).padStart(2, '0')).join('');
export const TOKEN_NAMES = ['button', 'bottle cap', 'marble', 'key'];

const s = `stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;
const thin = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`;

export const ground = `<path d="M-34 30 H34" ${s} fill="none"/>`;

export function forSale() {
  return `${ground}
    <path d="M0 30 V-2" ${s}/>
    <rect x="-30" y="-34" width="60" height="34" rx="3" fill="#fffaf0" ${s}/>
    <text x="0" y="-19" class="sign">FOR</text><text x="0" y="-4" class="sign">SALE</text>`;
}

export function sold(color) {
  let pickets = '';
  for (let x = -28; x <= 28; x += 11) pickets += `<path d="M${x} 30 V12 l3 -4 l3 4 V30" fill="#fffaf0" ${thin}/>`;
  return `${ground}
    <path d="M-30 22 H32 M-30 15 H32" ${thin}/>
    ${pickets}
    <path d="M-10 12 V-30" ${s}/>
    <path d="M-10 -30 L18 -22 L-10 -13 Z" fill="${color}" ${s}/>`;
}

export function house(color) {
  return `${ground}
    <rect x="-21" y="0" width="42" height="30" fill="#fffaf0" ${s}/>
    <path d="M-28 2 L0 -24 L28 2 Z" fill="${color}" ${s}/>
    <rect x="-6" y="12" width="12" height="18" fill="${INK}" opacity=".85"/>
    <rect x="-17" y="8" width="8" height="8" fill="#bfe0ee" ${thin}/>
    <rect x="9" y="8" width="8" height="8" fill="#bfe0ee" ${thin}/>
    <path d="M14 -12 V-22 h6 V-6" fill="#fffaf0" ${thin}/>`;
}

export function shop(color) {
  let stripes = '';
  for (let k = 0; k < 6; k++) stripes += `<path d="M${-28 + k * 9.33} 0 h4.66 l-1 8 h-4.66 Z" fill="${color}"/>`;
  return `${ground}
    <rect x="-26" y="-30" width="52" height="60" fill="#fffaf0" ${s}/>
    <rect x="-26" y="-36" width="52" height="8" fill="${color}" ${s}/>
    <rect x="-18" y="-22" width="12" height="12" fill="#bfe0ee" ${thin}/>
    <rect x="6" y="-22" width="12" height="12" fill="#bfe0ee" ${thin}/>
    <path d="M-29 0 H29 L27 8 H-27 Z" fill="#fffaf0" ${thin}/>${stripes}
    <path d="M-29 0 H29 L27 8 H-27 Z" fill="none" ${thin}/>
    <rect x="-20" y="12" width="22" height="14" fill="#bfe0ee" ${thin}/>
    <rect x="8" y="12" width="11" height="18" fill="${INK}" opacity=".85"/>`;
}

export function block(color) {
  let win = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) win += `<rect x="${-19 + c * 14}" y="${-38 + r * 15}" width="9" height="10" fill="#f7e3a1" ${thin}/>`;
  return `${ground}
    <rect x="-27" y="-46" width="54" height="76" fill="#b5654a" ${s}/>
    <rect x="-31" y="-54" width="62" height="10" fill="${color}" ${s}/>
    ${win}
    <rect x="-7" y="17" width="14" height="13" fill="${INK}" opacity=".85"/>`;
}

export const BUILDINGS = [null, house, shop, block];

export function depot(color) {
  const flag = color ? `<path d="M20 -18 V-44" ${s}/><path d="M20 -44 L38 -38 L20 -32 Z" fill="${color}" ${s}/>` : '';
  return `${ground}
    <rect x="-30" y="-6" width="60" height="36" fill="#fffaf0" ${s}/>
    <path d="M-36 -4 L0 -22 L36 -4 Z" fill="#7d6b5a" ${s}/>
    <circle cx="0" cy="6" r="6" fill="#fffaf0" ${thin}/><path d="M0 2 V6 H3" ${thin} fill="none"/>
    <rect x="-22" y="14" width="10" height="16" fill="${INK}" opacity=".85"/>
    <rect x="12" y="14" width="10" height="16" fill="${INK}" opacity=".85"/>${flag}`;
}

export const gazette = `${ground}
  <path d="M-28 -24 H22 V26 H-24 Q-28 26 -28 22 Z" fill="#fffaf0" ${s}/>
  <path d="M22 -14 H28 V22 Q28 26 24 26 H22" fill="#e8dcc0" ${s}/>
  <text x="-3" y="-8" class="mast">G</text>
  <path d="M-21 0 H15 M-21 7 H15 M-21 14 H3" ${thin}/>`;

export const lumber = `${ground}
  <rect x="-30" y="16" width="60" height="14" rx="2" fill="#d9a066" ${s}/>
  <rect x="-26" y="2" width="56" height="14" rx="2" fill="#e3b07a" ${s}/>
  <rect x="-30" y="-12" width="54" height="14" rx="2" fill="#d9a066" ${s}/>
  <circle cx="-24" cy="23" r="3" fill="none" ${thin}/><circle cx="24" cy="9" r="3" fill="none" ${thin}/>
  <path d="M8 -12 L20 -30 L30 -24 L18 -6" fill="#9aa3a8" ${s}/>`;

export const assessor = `${ground}
  <rect x="-26" y="-20" width="44" height="48" rx="2" fill="#fffaf0" ${s}/>
  <path d="M-19 -10 H11 M-19 -2 H11 M-19 6 H3" ${thin}/>
  <text x="-4" y="23" class="tag-ink">TAX</text>
  <circle cx="16" cy="-6" r="11" fill="#cfe6f0" fill-opacity=".7" ${s}/>
  <path d="M24 2 L34 14" ${s} stroke-width="5"/>`;

export const payday = `
  <circle cx="0" cy="-6" r="30" fill="#e8c35a" ${s}/>
  <circle cx="0" cy="-6" r="23" fill="none" ${thin}/>
  <text x="0" y="5" class="coin">$</text>`;

export const office = `${ground}
  <path d="M-30 -22 H24 V24 H-30 Z" fill="#fffaf0" ${s}/>
  <path d="M-22 -12 L-6 -16 L4 -6 L16 -12 V14 L4 18 L-6 8 L-22 12 Z" fill="#cfe0b0" ${thin}/>
  <path d="M-6 -16 V8 M4 -6 V18" ${thin}/>
  <circle cx="22" cy="20" r="10" fill="#c0392b" ${s}/>`;

export const square = `${ground}
  <path d="M-26 30 V22 H26 V30" fill="#fffaf0" ${s}/>
  <path d="M-22 22 V-6 M22 22 V-6 M0 22 V-6" ${s}/>
  <path d="M-32 -4 L0 -28 L32 -4 Z" fill="#c95a3f" ${s}/>
  <path d="M0 -28 V-36" ${s}/><circle cx="0" cy="-38" r="3" fill="${INK}"/>`;

export const hall = `${ground}
  <rect x="-30" y="-2" width="60" height="32" fill="#fffaf0" ${s}/>
  <path d="M-34 -2 H34 L0 -16 Z" fill="#e8dcc0" ${s}/>
  <path d="M-12 -12 A12 12 0 0 1 12 -12" fill="#9cb7a8" ${s}/>
  <path d="M0 -24 V-34" ${s}/><path d="M0 -34 L10 -31 L0 -28" fill="#c95a3f" ${thin}/>
  <path d="M-21 4 V28 M-9 4 V28 M9 4 V28 M21 4 V28" ${s}/>`;

// The playing pieces: things from a junk drawer, in each player's colour. Drawn round (0, 0), radius about 16.
export function token(k, color = PLAYER_COLORS[k]) {
  switch (k) {
    case 0: return `<circle r="15" fill="${color}" ${s}/><circle r="10" fill="none" stroke="#0003" stroke-width="2"/>
      <circle cx="-3.5" cy="-3.5" r="2.2" fill="${INK}"/><circle cx="3.5" cy="-3.5" r="2.2" fill="${INK}"/>
      <circle cx="-3.5" cy="3.5" r="2.2" fill="${INK}"/><circle cx="3.5" cy="3.5" r="2.2" fill="${INK}"/>`;
    case 1: {
      let d = '';
      for (let a = 0; a < 21; a++) {
        const t = (a / 21) * Math.PI * 2, r = a % 2 ? 13 : 16.5;
        d += `${a ? 'L' : 'M'}${(Math.cos(t) * r).toFixed(1)} ${(Math.sin(t) * r).toFixed(1)} `;
      }
      return `<path d="${d}Z" fill="${color}" ${s}/><circle r="9" fill="none" stroke="#fff8" stroke-width="2"/>`;
    }
    case 2: return `<circle r="15" fill="${color}" ${s}/>
      <path d="M-8 6 Q0 -4 9 -8" stroke="#fff9" stroke-width="3" fill="none"/>
      <ellipse cx="-5" cy="-6" rx="4" ry="3" fill="#fffc"/>`;
    default: return `<g transform="rotate(-35)"><circle cx="-7" r="10" fill="${color}" ${s}/><circle cx="-7" r="3.5" fill="${PAPER}" ${thin}/>
      <path d="M2 -3.5 H17 V0 H14 V4 H11 V0 H9 V4 H6 V0 H2 Z" fill="${color}" ${s}/></g>`;
  }
}

// A token as a whole little SVG, for player chips and sheets.
export const tokenSvg = (k, size = 28) =>
  `<svg viewBox="-20 -20 40 40" width="${size}" height="${size}" aria-hidden="true">${token(k)}</svg>`;

// A die face, value 1..6, as SVG.
export function dieFace(v, size = 56) {
  const pips = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[v] || [];
  return `<svg viewBox="-30 -30 60 60" width="${size}" height="${size}" aria-hidden="true">
    <rect x="-27" y="-27" width="54" height="54" rx="10" fill="#fffaf0" ${s}/>
    ${pips.map(([x, y]) => `<circle cx="${x * 13}" cy="${y * 13}" r="5.2" fill="${INK}"/>`).join('')}</svg>`;
}

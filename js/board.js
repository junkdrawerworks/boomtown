// The board: 28 spaces round a square, Payday in the bottom-right corner, play running clockwise
// (along the bottom to the left, up the left side, along the top, down the right side).

export const DISTRICTS = [
  { id: 'mill', name: 'Mill Row', color: '#9a6b47', build: 50 },
  { id: 'orchard', name: 'Orchard Lane', color: '#7f9a3e', build: 60 },
  { id: 'river', name: 'Riverside', color: '#3f8fa8', build: 80 },
  { id: 'main', name: 'Main Street', color: '#c95a3f', build: 100 },
  { id: 'bank', name: 'Bank Street', color: '#d3a23a', build: 120 },
  { id: 'hill', name: 'Hilltop', color: '#7a5a96', build: 140 },
];
export const DISTRICT = Object.fromEntries(DISTRICTS.map(d => [d.id, d]));

const lot = (name, district, price) => ({ type: 'lot', name, district, price });

export const SPACES = [
  { type: 'payday', name: 'Payday' },
  lot('Tannery Lane', 'mill', 60),
  lot('Mill Row', 'mill', 60),
  { type: 'gazette', name: 'The Gazette' },
  lot('Sawpit Alley', 'mill', 70),
  { type: 'depot', name: 'South Depot', price: 150 },
  lot('Cider Press', 'orchard', 90),
  { type: 'office', name: 'Land Office' },
  lot('Orchard Lane', 'orchard', 90),
  lot('Pear Tree Walk', 'orchard', 100),
  { type: 'yard', name: 'Lumberyard' },
  lot('Ferry Landing', 'river', 120),
  lot('Riverside', 'river', 120),
  lot('Boathouse Row', 'river', 140),
  { type: 'square', name: 'Town Square' },
  lot('Market Corner', 'main', 160),
  { type: 'gazette', name: 'The Gazette' },
  lot('Main Street', 'main', 160),
  lot('Picture House', 'main', 180),
  { type: 'depot', name: 'North Depot', price: 150 },
  lot('Counting House', 'bank', 200),
  { type: 'hall', name: 'City Hall' },
  lot('Bank Street', 'bank', 200),
  { type: 'tax', name: 'Assessor' },
  lot('Exchange Place', 'bank', 220),
  lot('Lookout Point', 'hill', 240),
  lot('Hilltop', 'hill', 240),
  lot('Belvedere', 'hill', 260),
];

export const N = SPACES.length;
export const OWNABLE = SPACES.map((s, i) => (s.type === 'lot' || s.type === 'depot' ? i : -1)).filter(i => i >= 0);
export const LOTS_IN = Object.fromEntries(DISTRICTS.map(d => [d.id, SPACES.map((s, i) => (s.district === d.id ? i : -1)).filter(i => i >= 0)]));
export const DEPOTS = SPACES.map((s, i) => (s.type === 'depot' ? i : -1)).filter(i => i >= 0);

// What each kind of space does, in a line, for its sheet. (A depot opens a lot's sheet, with its rents.) Amounts from
// RULES are added where the sheet is drawn, in app.js, since this file can't import game.js.
export const SPACE_HELP = {
  payday: 'Collect your pay each time you pass. Land here exactly for a bonus on top.',
  gazette: 'Read the town paper. Headlines move land values, pay out or cost you.',
  office: 'Buy any empty lot or depot in town at its price, if you want one.',
  yard: 'Build one level on one of your lots at half price.',
  square: 'Take everything in the kitty: fines and taxes paid since someone last stopped here.',
  hall: 'Rezone a district: its land goes up 20%.',
  tax: 'The town assessor comes round.',
};

// Board geometry: 900 units wide, corners 150 square, six spaces of 100 between corners along the top and bottom.
// The board can be taller than it is wide (on a phone held upright), which makes the spaces down the sides taller.
// Returns the cell rectangle for space i, and which side it's on.
export const SIZE = 900, CORNER = 150, CELL = 100;
export function cellRect(i, H = SIZE) {
  const W = SIZE, CH = (H - 2 * CORNER) / 6;
  if (i === 0) return { x: W - CORNER, y: H - CORNER, w: CORNER, h: CORNER, side: 'corner' };
  if (i === 7) return { x: 0, y: H - CORNER, w: CORNER, h: CORNER, side: 'corner' };
  if (i === 14) return { x: 0, y: 0, w: CORNER, h: CORNER, side: 'corner' };
  if (i === 21) return { x: W - CORNER, y: 0, w: CORNER, h: CORNER, side: 'corner' };
  if (i < 7) return { x: W - CORNER - i * CELL, y: H - CORNER, w: CELL, h: CORNER, side: 'bottom' };
  if (i < 14) return { x: 0, y: H - CORNER - (i - 7) * CH, w: CORNER, h: CH, side: 'left' };
  if (i < 21) return { x: CORNER + (i - 15) * CELL, y: 0, w: CELL, h: CORNER, side: 'top' };
  return { x: W - CORNER, y: CORNER + (i - 22) * CH, w: CORNER, h: CH, side: 'right' };
}

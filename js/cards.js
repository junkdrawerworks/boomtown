// The Gazette: one headline per visit. `do` is applied by the game engine (see applyCard in game.js).

export const CARDS = [
  { id: 'boom-mill', head: 'Mill whistle blows again', body: 'The old mill reopens with forty jobs. Mill Row land goes up 20%.', do: { land: { mill: 0.2 } } },
  { id: 'boom-orchard', head: 'Bumper harvest', body: 'The cider press runs all night. Orchard Lane land goes up 20%.', do: { land: { orchard: 0.2 } } },
  { id: 'boom-river', head: 'Ferry service starts Monday', body: 'Riverside land goes up 20%.', do: { land: { river: 0.2 } } },
  { id: 'boom-main', head: 'Picture house to show talkies', body: 'Crowds on Main Street every night. Main Street land goes up 20%.', do: { land: { main: 0.2 } } },
  { id: 'boom-bank', head: 'Insurance firm moves in', body: 'Bank Street land goes up 20%.', do: { land: { bank: 0.2 } } },
  { id: 'boom-hill', head: 'Doctor builds on the hill', body: 'Everyone wants the view now. Hilltop land goes up 20%.', do: { land: { hill: 0.2 } } },
  { id: 'bust-river', head: 'River over its banks', body: 'Riverside land goes down 15%.', do: { land: { river: -0.15 } } },
  { id: 'bust-main', head: 'Main Street dug up for paving', body: 'Nobody can get to the shops. Main Street land goes down 15%.', do: { land: { main: -0.15 } } },
  { id: 'bust-hill', head: 'Fog on the hill all month', body: 'Hilltop land goes down 15%.', do: { land: { hill: -0.15 } } },
  { id: 'boom-all', head: 'Building boom', body: 'Every district with a building in it goes up 10%.', do: { landBuilt: 0.1 } },
  { id: 'bust-all', head: 'New highway bypasses town', body: 'Every district goes down 10%.', do: { landAll: -0.1 } },
  { id: 'fair', head: 'County fair comes to town', body: 'Everyone collects $50 from the fair committee.', do: { everyone: 50 } },
  { id: 'inherit', head: 'A great-aunt remembers you', body: 'Collect $100.', do: { collect: 100 } },
  { id: 'pipes', head: 'Cold snap bursts the pipes', body: 'Pay $15 for every building level you own, into the kitty.', do: { perLevel: 15 } },
  { id: 'lawn', head: 'Fined for an overgrown lawn', body: 'Pay $50 into the kitty.', do: { fine: 50 } },
  { id: 'express', head: 'Catch the express', body: 'Move ahead to the next depot.', do: { toDepot: true } },
  { id: 'early', head: 'Payday comes early', body: 'Move ahead to Payday.', do: { toPayday: true } },
  { id: 'estate', head: 'Estate sale this weekend', body: 'Buy any empty lot in town at half its price, if you want one.', do: { estate: true } },
];
export const CARD = Object.fromEntries(CARDS.map(c => [c.id, c]));

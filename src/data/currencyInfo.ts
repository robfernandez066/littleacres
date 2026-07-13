/** All game data lives in config - the coin/moondust info card copy included. */
export type CurrencyId = 'coins' | 'moondust';

export interface CurrencyInfoDef {
  title: string;
  body: string;
}

export const CURRENCY_INFO: Record<CurrencyId, CurrencyInfoDef> = {
  coins: {
    title: 'Coins',
    body: 'Earned by selling crops and fulfilling orders at the notice board. Spent on seeds, new plots, and decorations.',
  },
  moondust: {
    title: 'Moondust',
    body: 'A rare shimmer from Radiant harvests and premium orders. Spend it on special decorations at the farmhouse shop.',
  },
};

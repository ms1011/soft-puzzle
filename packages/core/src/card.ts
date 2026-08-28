export type Suit = 'S' | 'H' | 'D' | 'C';
export type Card = string;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export function makeDeck(opts?: { jokers?: boolean }): Card[] {
  const cards: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      cards.push(rank + suit);
    }
  }
  if (opts?.jokers) {
    cards.push('JB');
    cards.push('JR');
  }
  return cards;
}

export function suitOf(c: Card): Suit | null {
  // Check for jokers first
  if (c === 'JB' || c === 'JR') {
    return null;
  }
  const lastChar = c[c.length - 1];
  if (lastChar === 'S' || lastChar === 'H' || lastChar === 'D' || lastChar === 'C') {
    return lastChar as Suit;
  }
  return null;
}

export function rankOf(c: Card): string {
  // Check for jokers first
  if (c === 'JB' || c === 'JR') {
    return 'JOKER';
  }
  // Return everything before the last character (the suit)
  return c.slice(0, -1);
}

export function isRed(c: Card): boolean {
  if (c === 'JR') {
    return true;
  }
  const suit = suitOf(c);
  return suit === 'H' || suit === 'D';
}

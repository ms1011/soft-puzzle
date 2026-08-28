import { it, expect } from 'vitest';
import { makeDeck, suitOf, rankOf, isRed } from '../src/card.js';
it('조커 없는 덱은 52장, 중복 없음', () => {
  const d = makeDeck();
  expect(d).toHaveLength(52);
  expect(new Set(d).size).toBe(52);
});
it('조커 덱은 54장이고 JB/JR 포함', () => {
  const d = makeDeck({ jokers: true });
  expect(d).toHaveLength(54);
  expect(d).toContain('JB'); expect(d).toContain('JR');
});
it('카드 속성 판정', () => {
  expect(suitOf('KH')).toBe('H'); expect(suitOf('JB')).toBeNull();
  expect(suitOf('10D')).toBe('D'); expect(suitOf('JR')).toBeNull();
  expect(rankOf('10D')).toBe('10'); expect(rankOf('JR')).toBe('JOKER');
  expect(rankOf('JB')).toBe('JOKER');
  expect(isRed('JR')).toBe(true); expect(isRed('AS')).toBe(false);
});

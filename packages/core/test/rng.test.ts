import { it, expect } from 'vitest';
import { mulberry32, shuffle } from '../src/rng.js';
it('같은 시드는 같은 셔플 결과', () => {
  const a = shuffle([1,2,3,4,5], mulberry32(42));
  const b = shuffle([1,2,3,4,5], mulberry32(42));
  expect(a).toEqual(b);
  expect(a.slice().sort()).toEqual([1,2,3,4,5]); // 원소 보존
});
it('원본을 변경하지 않는다', () => {
  const src = [1,2,3]; shuffle(src, mulberry32(1));
  expect(src).toEqual([1,2,3]);
});

import { describe, expect, it } from 'vitest';
import { OneCardEngine } from '../src/games/onecard.js';
import { mulberry32 } from '../src/rng.js';

describe('OneCardEngine.focusRoute', () => {
  function started() {
    const e = new OneCardEngine();
    e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
    return e; // 첫 차례는 철수, 손패 7장
  }

  it('차례인 사람의 유효한 index는 정리된 { index }로 전원에게 간다', () => {
    expect(started().focusRoute('철수', { index: 3, extra: 'x' })).toEqual({ to: 'all', target: { index: 3 } });
  });

  it('null은 "고민 중 아님"으로 전원에게 간다', () => {
    expect(started().focusRoute('철수', null)).toEqual({ to: 'all', target: null });
  });

  it('차례가 아니거나, 범위 밖이거나, 정수가 아니면 null', () => {
    const e = started();
    expect(e.focusRoute('영희', { index: 0 })).toBeNull();
    expect(e.focusRoute('철수', { index: 7 })).toBeNull();
    expect(e.focusRoute('철수', { index: -1 })).toBeNull();
    expect(e.focusRoute('철수', { index: 1.5 })).toBeNull();
    expect(e.focusRoute('철수', 'hello')).toBeNull();
  });
});

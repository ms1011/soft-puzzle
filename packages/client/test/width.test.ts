import { describe, it, expect } from 'vitest';
import { displayWidth } from '../src/art/width.js';

describe('displayWidth', () => {
  it('ASCII 문자열은 코드포인트 수와 폭이 같다', () => {
    expect(displayWidth('HELD')).toBe(4);
    expect(displayWidth('[3]')).toBe(3);
    expect(displayWidth('')).toBe(0);
  });

  it('한글 음절은 하나당 2칼럼이다', () => {
    expect(displayWidth('잡음')).toBe(4); // 2글자 × 2칼럼
    expect(displayWidth('하트')).toBe(4);
  });

  it('ASCII와 한글이 섞이면 각각의 폭을 더한 값이다', () => {
    expect(displayWidth('[잡음]')).toBe(6); // '[' 1 + '잡' 2 + '음' 2 + ']' 1
    expect(displayWidth('하트K')).toBe(5); // '하' 2 + '트' 2 + 'K' 1
  });
});

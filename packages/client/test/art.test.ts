import { describe, it, expect } from 'vitest';
import { renderCard, renderHand, renderHandSegments } from '../src/art/cards.js';
import { renderDie, renderDice } from '../src/art/dice.js';
import { detectTheme } from '../src/art/theme.js';
import { displayWidth } from '../src/art/width.js';

const UNICODE = { unicode: true };
const ASCII = { unicode: false };

describe('cards', () => {
  it('KH 카드는 7칸×5줄', () => {
    const art = renderCard('KH', UNICODE);
    expect(art).toHaveLength(5);
    for (const line of art) expect([...line]).toHaveLength(7); // 코드포인트 기준
    expect(art.join('\n')).toContain('♥');
  });

  it('10은 2글자 랭크라도 7칸을 유지한다 (패딩 소비)', () => {
    const art = renderCard('10D', UNICODE);
    for (const line of art) expect([...line]).toHaveLength(7);
    expect(art[1]).toBe('│10   │');
    expect(art[3]).toBe('│   10│');
  });

  it('조커 두 장은 서로 다르게 렌더된다', () => {
    const black = renderCard('JB', UNICODE);
    const red = renderCard('JR', UNICODE);
    for (const line of [...black, ...red]) expect([...line]).toHaveLength(7);
    expect(black.join('\n')).not.toBe(red.join('\n'));
    expect(black[1]).toContain('JB');
    expect(red[1]).toContain('JR');
  });

  it('카드 뒷면은 ▒로 채워지고 7칸×5줄이다', () => {
    const art = renderCard('back', UNICODE);
    expect(art).toHaveLength(5);
    for (const line of art) expect([...line]).toHaveLength(7);
    expect(art[1]).toBe('│▒▒▒▒▒│');
    expect(art[2]).toBe('│▒▒▒▒▒│');
    expect(art[3]).toBe('│▒▒▒▒▒│');
  });

  it('겹침 렌더: 3장이면 폭 = 2+2+7', () => {
    const art = renderHand(['KH', '7D', 'AS'], UNICODE);
    expect([...art[0]]).toHaveLength(11);
  });

  it('겹침 폭 공식: n장 → 2(n-1)+7 (n=1,2,3)', () => {
    const deck = ['KH', '7D', 'AS', 'QC', '9H'];
    for (const n of [1, 2, 3]) {
      const art = renderHand(deck.slice(0, n), UNICODE);
      const expected = 2 * (n - 1) + 7;
      expect(art).toHaveLength(5);
      for (const line of art) expect([...line]).toHaveLength(expected);
    }
  });

  it('n=1일 때는 renderCard와 동일하다', () => {
    expect(renderHand(['KH'], UNICODE)).toEqual(renderCard('KH', UNICODE));
  });

  it('빈 손패는 던지지 않고 5줄의 빈 문자열을 돌려준다', () => {
    const art = renderHand([], UNICODE);
    expect(art).toHaveLength(5);
    for (const line of art) expect(line).toBe('');
  });

  it('ascii 테마에는 비ASCII 문자가 없다', () => {
    const all = [...renderCard('KH', ASCII), ...renderDie(4, true, ASCII)].join('');
    expect(/^[\x20-\x7e]*$/.test(all)).toBe(true);
  });

  it('ascii 카드도 폭은 동일하게 7칸×5줄이고 10 랭크도 유지된다', () => {
    const art = renderCard('10H', ASCII);
    expect(art).toHaveLength(5);
    for (const line of art) expect([...line]).toHaveLength(7);
    expect(art.join('\n')).toContain('H');
  });

  it('ascii 카드 뒷면은 #으로 채워진다', () => {
    const art = renderCard('back', ASCII);
    expect(art[1]).toBe('|#####|');
  });
});

describe('renderHandSegments', () => {
  it('조각을 이어 붙이면 renderHand와 같은 줄이 된다', () => {
    const cards = ['KH', '3S', 'back', 'JR'] as const;
    const rows = renderHandSegments([...cards], UNICODE);
    expect(rows.map((row) => row.map((s) => s.text).join(''))).toEqual(renderHand([...cards], UNICODE));
  });

  it('하트·다이아·빨간 조커만 red 조각이다(뒷면·검은 무늬·검은 조커는 아님)', () => {
    const rows = renderHandSegments(['KH', '3S', '5D', 'back', 'JB', 'JR'], UNICODE);
    expect(rows[0]!.map((s) => s.red)).toEqual([true, false, true, false, false, true]);
    // 모든 줄에서 같은 판정 — 카드 단위로 색을 입힌다.
    for (const row of rows) expect(row.map((s) => s.red)).toEqual(rows[0]!.map((s) => s.red));
  });

  it('빈 손패면 5줄의 빈 조각 목록이다', () => {
    const rows = renderHandSegments([], UNICODE);
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row).toEqual([]);
  });
});

describe('dice', () => {
  it('주사위 스냅샷', () => {
    expect(renderDie(5, false, UNICODE).join('\n')).toMatchInlineSnapshot(`
      "┌───────┐
      │ ●   ● │
      │   ●   │
      │ ●   ● │
      └───────┘"
    `);
    expect(renderDie(6, true, UNICODE).join('\n')).toMatchInlineSnapshot(`
      "╔═══════╗
      ║ ●   ● ║
      ║ ●   ● ║
      ║ ●   ● ║
      ╚═══════╝"
    `);
    expect(renderDie(3, false, ASCII).join('\n')).toMatchInlineSnapshot(`
      "+-------+
      | o     |
      |   o   |
      |     o |
      +-------+"
    `);
  });

  it('주사위는 항상 9칸×5줄 (모든 눈, 홀드 여부, 테마 조합)', () => {
    for (const v of [1, 2, 3, 4, 5, 6] as const) {
      for (const held of [true, false]) {
        for (const theme of [UNICODE, ASCII]) {
          const art = renderDie(v, held, theme);
          expect(art).toHaveLength(5);
          for (const line of art) expect([...line]).toHaveLength(9);
        }
      }
    }
  });

  it('홀드된 주사위는 이중선 테두리를 사용한다(유니코드)', () => {
    const art = renderDie(4, true, UNICODE);
    expect(art[0]).toBe('╔═══════╗');
    expect(art[4]).toBe('╚═══════╝');
  });

  it('1은 중앙에 눈 하나', () => {
    expect(renderDie(1, false, UNICODE)[2]).toBe('│   ●   │');
    expect(renderDie(1, false, UNICODE)[1]).toBe('│       │');
    expect(renderDie(1, false, UNICODE)[3]).toBe('│       │');
  });

  it('2는 대각선', () => {
    const art = renderDie(2, false, UNICODE);
    expect(art[1]).toBe('│ ●     │');
    expect(art[2]).toBe('│       │');
    expect(art[3]).toBe('│     ● │');
  });

  it('4는 네 모서리', () => {
    const art = renderDie(4, false, UNICODE);
    expect(art[1]).toBe('│ ●   ● │');
    expect(art[2]).toBe('│       │');
    expect(art[3]).toBe('│ ●   ● │');
  });

  it('6은 좌우 두 열(세 줄 모두)', () => {
    const art = renderDie(6, false, UNICODE);
    expect(art[1]).toBe('│ ●   ● │');
    expect(art[2]).toBe('│ ●   ● │');
    expect(art[3]).toBe('│ ●   ● │');
  });

  it('ascii 홀드 주사위는 #으로 테두리를 그리고 9칸을 유지한다', () => {
    const art = renderDie(2, true, ASCII);
    expect(art[0]).toBe('#########');
    expect(art[4]).toBe('#########');
    for (const line of art) {
      expect([...line]).toHaveLength(9);
      expect(/^[\x20-\x7e]*$/.test(line)).toBe(true);
    }
  });

  it('renderDice: 가로 배열 + 아래 라벨(면 값 또는 [잡음])', () => {
    const art = renderDice([3, 6], [false, true], UNICODE);
    expect(art).toHaveLength(6); // 5줄 아트 + 1줄 라벨
    for (const line of art.slice(0, 5)) expect([...line]).toHaveLength(19); // 9+1(구분)+9
    expect(art[5]).toContain('3');
    expect(art[5]).toContain('[잡음]');
    expect(art[5]).not.toContain('6'); // 홀드된 주사위는 숫자 대신 [잡음] 라벨
  });

  it('ascii 테마의 renderDice에는 비ASCII 문자가 없다 (홀드 라벨 포함)', () => {
    const art = renderDice([3, 6], [false, true], ASCII);
    const all = art.join('');
    expect(/^[\x20-\x7e]*$/.test(all)).toBe(true);
    expect(all).not.toContain('잡음');
    expect(art[5]).toContain('[HELD]');
  });

  it('renderDice 라벨 줄은 실제 표시 폭 기준으로 아트 줄과 정렬된다', () => {
    const art = renderDice([3, 6], [false, true], UNICODE);
    expect(displayWidth(art[0])).toBe(19); // 9+1(구분)+9, 아트 줄은 전부 좁은 문자
    expect(displayWidth(art[5])).toBe(19); // 라벨 줄도 칼럼 기준으로는 동일해야 함
  });

  it('renderDice: 빈 배열이면 던지지 않는다', () => {
    const art = renderDice([], [], UNICODE);
    expect(art).toHaveLength(6);
    for (const line of art) expect(line).toBe('');
  });
});

describe('theme', () => {
  it('detectTheme: --ascii 플래그와 구형 콘솔 감지', () => {
    expect(detectTheme(['--ascii'], {}).unicode).toBe(false);
    expect(detectTheme([], { WT_SESSION: 'x' }).unicode).toBe(true);
  });

  it('win32 + 신형 터미널 마커 없음 → ascii', () => {
    expect(detectTheme([], {}, 'win32').unicode).toBe(false);
  });

  it('win32 + WT_SESSION → unicode', () => {
    expect(detectTheme([], { WT_SESSION: '1' }, 'win32').unicode).toBe(true);
  });

  it('win32 + ConEmuANSI → unicode', () => {
    expect(detectTheme([], { ConEmuANSI: 'ON' }, 'win32').unicode).toBe(true);
  });

  it('win32 + VS Code 통합 터미널(TERM_PROGRAM=vscode) → unicode', () => {
    expect(detectTheme([], { TERM_PROGRAM: 'vscode' }, 'win32').unicode).toBe(true);
  });

  it('win32이라도 --ascii가 있으면 무조건 ascii', () => {
    expect(detectTheme(['--ascii'], { WT_SESSION: '1' }, 'win32').unicode).toBe(false);
  });

  it('win32이 아닌 플랫폼은 기본 unicode', () => {
    expect(detectTheme([], {}, 'darwin').unicode).toBe(true);
    expect(detectTheme([], {}, 'linux').unicode).toBe(true);
  });
});

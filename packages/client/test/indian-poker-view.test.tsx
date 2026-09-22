import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { IndianPokerView } from '../src/ui/game/IndianPokerView.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { findNonAsciiNonHangul, renderAtWidth } from './testUtils.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function indianView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'betting',
    yourActions: ['call', 'fold'],
    yourCard: '?',
    isTurn: true,
    round: 3,
    remainingCards: 40,
    pot: 4,
    scores: [{ nickname: '철수', score: 1 }, { nickname: '영희', score: 2 }, { nickname: '민수', score: 0 }],
    chips: [{ nickname: '철수', chips: 49 }, { nickname: '영희', chips: 51 }, { nickname: '민수', chips: 50 }],
    others: [
      { nickname: '영희', card: 'KH', folded: false, isTurn: false },
      { nickname: '민수', card: '7S', folded: true, isTurn: false },
    ],
    ...overrides,
  };
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return { view: indianView(), you: '철수', send: vi.fn(), theme: { unicode: true }, ...overrides };
}

describe('IndianPokerView', () => {
  it('상대 카드를 코드 문자열이 아니라 카드 아트로 그리고, 내 카드는 뒷면이다', () => {
    const { lastFrame, unmount } = render(<IndianPokerView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('♥');
    expect(frame).toContain('♠');
    expect(frame).toContain('▒▒▒▒▒');
    expect(frame).not.toMatch(/\bKH\b/);
    unmount();
  });

  it('좌석마다 칩과 승수, 폴드 여부를 보여준다', () => {
    const { lastFrame, unmount } = render(<IndianPokerView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('칩 51');
    expect(frame).toContain('2승');
    expect(frame).toContain('폴드');
    expect(frame).toContain('팟 4칩');
    unmount();
  });

  it('차례인 좌석에 차례 표시를 붙인다', () => {
    const view = indianView({ yourActions: [], isTurn: false, others: [{ nickname: '영희', card: 'KH', folded: false, isTurn: true }] });
    const { lastFrame, unmount } = render(<IndianPokerView {...baseProps({ view })} />);
    expect(lastFrame()).toContain('◀ 영희');
    unmount();
  });

  it('Enter는 call, f는 fold를 보낸다', async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<IndianPokerView {...baseProps({ send })} />);
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('f');
    await tick();
    expect(send.mock.calls).toEqual([['call'], ['fold']]);
    unmount();
  });

  it('6인도 80칼럼 안에서 좌석이 한 줄에 놓인다', () => {
    const names = ['영희', '민수', '지민', '서연', '도윤'];
    const view = indianView({
      others: names.map((nickname) => ({ nickname, card: 'AD', folded: false, isTurn: false })),
      chips: [{ nickname: '철수', chips: 50 }, ...names.map((nickname) => ({ nickname, chips: 50 }))],
      scores: [],
    });
    const { lastFrame, unmount } = renderAtWidth(<IndianPokerView {...baseProps({ view })} />, 80);
    const nameLine = (lastFrame() ?? '').split('\n').find((line) => line.includes('철수'))!;
    for (const name of names) expect(nameLine).toContain(name);
    unmount();
  });

  it('--ascii 테마에서 ASCII·한글 외 문자가 새지 않는다', () => {
    const { lastFrame, unmount } = render(<IndianPokerView {...baseProps({ theme: { unicode: false } })} />);
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
    unmount();
  });
});

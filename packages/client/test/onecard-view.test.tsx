import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { OneCardView } from '../src/ui/game/OneCardView.js';
import type { GameViewProps } from '../src/ui/game/types.js';

const ESC = '';
const RIGHT_ARROW = `${ESC}[C`;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function playingView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'playing' as const,
    yourActions: ['play', 'draw'],
    you: { hand: ['KH', '3S', '5H'], handCount: 3, isTurn: true },
    others: [{ nickname: '영희', handCount: 5, isTurn: false }],
    top: '3H',
    declaredSuit: null,
    attackStack: 0,
    direction: 1,
    ...overrides,
  };
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return {
    view: playingView(),
    you: '철수',
    send: vi.fn(),
    theme: { unicode: true },
    ...overrides,
  };
}

describe('OneCardView', () => {
  it('내 패를 겹침 아트로 그리고 커서로 카드를 이동할 수 있다', async () => {
    const { lastFrame, stdin, unmount } = render(<OneCardView {...baseProps()} />);
    await tick();
    const frame1 = lastFrame() ?? '';
    expect(frame1).toContain('K');
    stdin.write(RIGHT_ARROW);
    await tick();
    const frame2 = lastFrame() ?? '';
    expect(frame2).not.toBe(frame1); // 커서 이동으로 강조(들린 카드) 위치가 바뀐다
    unmount();
  });

  it('top 카드와 공격 스택을 표시한다', () => {
    const view = playingView({ attackStack: 7, top: '2H' });
    const { lastFrame, unmount } = render(<OneCardView {...baseProps({ view })} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('7');
    unmount();
  });

  it('7이 아닌 낼 수 있는 카드를 선택해 Enter를 치면 play를 보낸다', async () => {
    const send = vi.fn();
    // top: 3H(무늬 H). 커서 0번 카드는 KH — 같은 무늬라 낼 수 있다.
    const { stdin, unmount } = render(<OneCardView {...baseProps({ send })} />);
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('play', { card: 'KH' });
    unmount();
  });

  it('7을 낼 때는 무늬 선택 팝업을 거쳐 declareSuit과 함께 play를 보낸다', async () => {
    const view = playingView({
      you: { hand: ['7S', '3S'], handCount: 2, isTurn: true },
      top: '9S', // 무늬 S — 커서 0번 카드 7S와 같은 무늬라 바로 낼 수 있다.
    });
    const send = vi.fn();
    const { stdin, unmount } = render(<OneCardView {...baseProps({ view, send })} />);
    await tick();
    stdin.write('\r'); // 7 선택 → 무늬 선택 팝업이 열려야 한다(아직 send 안 됨)
    await tick();
    expect(send).not.toHaveBeenCalled();
    stdin.write('\r'); // 팝업의 기본 선택(첫 무늬)으로 확정
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    const [name, arg] = send.mock.calls[0] as [string, { card: string; declareSuit: string }];
    expect(name).toBe('play');
    expect(arg.card).toBe('7S');
    expect(['S', 'H', 'D', 'C']).toContain(arg.declareSuit);
    unmount();
  });

  it("d 입력이 send('draw')를 호출한다", async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<OneCardView {...baseProps({ send })} />);
    await tick();
    stdin.write('d');
    await tick();
    expect(send).toHaveBeenCalledWith('draw');
    unmount();
  });

  it("내 턴이 아니면(yourActions가 비어 있으면) d나 Enter를 눌러도 아무 것도 보내지 않는다", async () => {
    const send = vi.fn();
    const view = playingView({ yourActions: [], you: { hand: ['KH'], handCount: 1, isTurn: false } });
    const { stdin, unmount } = render(<OneCardView {...baseProps({ view, send })} />);
    await tick();
    stdin.write('d');
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it('낼 수 없는 카드에 Enter를 쳐도 아무 것도 보내지 않는다(canPlay는 힌트일 뿐, 클라에서도 무시)', async () => {
    const send = vi.fn();
    // top: 3H(무늬 H, 랭크 3). 커서 0번 카드 8S는 무늬도 랭크도 안 맞아 낼 수 없다.
    const view = playingView({ you: { hand: ['8S', '3S'], handCount: 2, isTurn: true }, top: '3H' });
    const { stdin, unmount } = render(<OneCardView {...baseProps({ view, send })} />);
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it('빈 손패(완주)여도 예외 없이 렌더된다', () => {
    const view = playingView({ you: { hand: [], handCount: 0, isTurn: false }, yourActions: [] });
    expect(() => {
      const { unmount } = render(<OneCardView {...baseProps({ view })} />);
      unmount();
    }).not.toThrow();
  });

  it('상대는 닉네임과 장수만 보여주고 카드 내용은 보여주지 않는다', () => {
    const { lastFrame, unmount } = render(<OneCardView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('영희');
    expect(frame).toContain('5');
    unmount();
  });
});

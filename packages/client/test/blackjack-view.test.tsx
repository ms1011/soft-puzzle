import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { BlackjackView } from '../src/ui/game/BlackjackView.js';
import type { GameViewProps } from '../src/ui/game/types.js';

/** ink는 keypress를 마운트 이후 useEffect로 등록한 리스너로 처리한다 — 첫 입력 전에 한 틱
 * 양보해야 유실되지 않는다(다른 화면 테스트들과 동일한 패턴). */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

const actingView = {
  phase: 'acting' as const,
  yourActions: ['hit', 'stand'],
  you: { hand: ['7H', '10S'], chips: 990, bet: 10, spectating: false },
  others: [
    {
      nickname: '영희',
      handCount: 2,
      hand: ['5H', '6D'],
      chips: 990,
      bet: 10,
      isTurn: false,
      spectating: false,
    },
  ],
  dealer: { hand: ['9S'], hiddenCount: 1 },
};

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return {
    view: actingView,
    you: '철수',
    send: vi.fn(),
    theme: { unicode: true },
    ...overrides,
  };
}

describe('BlackjackView', () => {
  it('내 패 두 장의 아트와 합계 (17)을 보여준다', () => {
    const { lastFrame, unmount } = render(<BlackjackView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(17)');
    // 카드 랭크 아트(7, 10)가 실제로 그려졌는지도 확인 — 합계 숫자만 보고 카드 아트가
    // 실제로 렌더됐다고 착각하지 않기 위한 대조.
    expect(frame).toContain('7');
    expect(frame).toContain('10');
    unmount();
  });

  it('딜러의 숨김 카드를 뒷면(back)으로 그린다', () => {
    const { lastFrame, unmount } = render(<BlackjackView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    // dealer.hiddenCount: 1 — renderCard('back', theme)가 채우는 뒷면 패턴이 나와야 한다.
    expect(frame).toContain('▒');
    unmount();
  });

  it("yourActions에 'hit'이 있으면 h 입력이 send('hit')을 호출한다", async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<BlackjackView {...baseProps({ send })} />);
    await tick();
    stdin.write('h');
    await tick();
    expect(send).toHaveBeenCalledWith('hit');
    unmount();
  });

  it("yourActions에 'double'이 없으면 d 입력이 아무 것도 보내지 않는다", async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<BlackjackView {...baseProps({ send })} />);
    await tick();
    stdin.write('d');
    await tick();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it("betting phase에서 bet이 yourActions에 있으면 Enter로 send('bet', 금액)을 보낸다", async () => {
    const send = vi.fn();
    const bettingView = {
      phase: 'betting' as const,
      yourActions: ['bet'],
      you: { hand: [], chips: 990, bet: 0, spectating: false },
      others: [
        { nickname: '영희', handCount: 0, hand: [], chips: 1000, bet: 0, isTurn: false, spectating: false },
      ],
      dealer: { hand: [], hiddenCount: 0 },
    };
    const { stdin, unmount } = render(
      <BlackjackView {...baseProps({ view: bettingView, send })} />,
    );
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('bet', expect.any(Number));
    const [, amount] = send.mock.calls[0] as [string, number];
    expect(amount).toBeGreaterThanOrEqual(10);
    expect(amount).toBeLessThanOrEqual(990);
    unmount();
  });

  it("betting phase에서 bet이 yourActions에 없으면(이미 베팅함) Enter가 아무 것도 보내지 않는다", async () => {
    const send = vi.fn();
    const bettingView = {
      phase: 'betting' as const,
      yourActions: [] as string[],
      you: { hand: [], chips: 980, bet: 10, spectating: false },
      others: [
        { nickname: '영희', handCount: 0, hand: [], chips: 1000, bet: 0, isTurn: false, spectating: false },
      ],
      dealer: { hand: [], hiddenCount: 0 },
    };
    const { stdin, unmount } = render(
      <BlackjackView {...baseProps({ view: bettingView, send })} />,
    );
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it('settle phase에서 host가 아니면 endGame 키(e)를 눌러도 아무 것도 보내지 않는다', async () => {
    const send = vi.fn();
    const settleView = {
      phase: 'settle' as const,
      yourActions: ['ready'],
      you: { hand: ['7H', '10S'], chips: 1015, bet: 0, spectating: false },
      others: [
        {
          nickname: '영희',
          handCount: 2,
          hand: ['5H', '6D'],
          chips: 990,
          bet: 0,
          isTurn: false,
          spectating: false,
        },
      ],
      dealer: { hand: ['9S', '8D'], hiddenCount: 0 },
    };
    const { stdin, unmount } = render(<BlackjackView {...baseProps({ view: settleView, send })} />);
    await tick();
    stdin.write('e');
    await tick();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it('빈 손패(관전자)와 상대 1명만 있어도 예외 없이 렌더된다', () => {
    const spectatorView = {
      phase: 'betting' as const,
      yourActions: [] as string[],
      you: { hand: [], chips: 0, bet: 0, spectating: true },
      others: [
        { nickname: '영희', handCount: 0, hand: [], chips: 1000, bet: 0, isTurn: false, spectating: false },
      ],
      dealer: { hand: [], hiddenCount: 0 },
    };
    expect(() => {
      const { unmount } = render(<BlackjackView {...baseProps({ view: spectatorView })} />);
      unmount();
    }).not.toThrow();
  });
});

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { BlackjackView } from '../src/ui/game/BlackjackView.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { findNonAsciiNonHangul } from './testUtils.js';

/** ink는 keypress를 마운트 이후 useEffect로 등록한 리스너로 처리한다 — 첫 입력 전에 한 틱
 * 양보해야 유실되지 않는다(다른 화면 테스트들과 동일한 패턴). */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

const ESC = String.fromCharCode(27);
const UP_ARROW = `${ESC}[A`;

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

  it('딜러의 공개 카드는 뒷면 뒤에서도 무늬까지 온전히 보인다(회귀: 카드 순서 버그)', () => {
    // 회귀 테스트: dealer 카드 배열을 [공개..., 뒷면...] 순서로 넘기면 renderHand가
    // 마지막(뒷면)만 온전히 그리고 공개 카드는 2칸으로 잘려 무늬(♠)가 아예 안 보였다.
    // dealer.hand: ['9S'], hiddenCount: 1 — 공개된 9S의 무늬(♠)가 실제로 보여야 한다.
    //
    // 리뷰 지적: 처음 버전은 frame 전체에서 '♠'를 찾았는데, actingView의 내 손패
    // (['7H', '10S'])에 있는 10S도 마지막 카드라 항상 온전한 폭으로 그려져 '♠'를
    // 낸다 — 딜러 순서를 일부러 되돌려도(버그 재현) 이 무관한 카드 때문에 테스트가
    // 계속 통과했다. 딜러 행만(다음 좌석 줄 전까지) 잘라서 그 안에서만 확인한다.
    const { lastFrame, unmount } = render(<BlackjackView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const dealerIdx = lines.findIndex((l) => l.includes('딜러'));
    expect(dealerIdx).toBeGreaterThanOrEqual(0);
    const nextSeatIdx = lines.findIndex((l, i) => i > dealerIdx && l.includes('철수'));
    expect(nextSeatIdx).toBeGreaterThan(dealerIdx);
    const dealerBlock = lines.slice(dealerIdx, nextSeatIdx).join('\n');
    expect(dealerBlock).toContain('♠');
    unmount();
  });

  it('회귀: 칩이 10의 배수가 아니어도(자연 블랙잭 배당 등) 최대 베팅액은 10의 배수로 내림된다', async () => {
    // chips: 1015(10칩 베팅 후 자연 블랙잭 승리 시 나오는 액수) — maxBet을 chips 그대로
    // 쓰면 1015가 되어 Enter를 눌러도 엔진이 `arg % 10 !== 0`로 조용히 거부한다(화면이
    // 멈춘 것처럼 보임). 올바른 최대값은 1,010이다.
    const send = vi.fn();
    const bettingView = {
      phase: 'betting' as const,
      yourActions: ['bet'],
      you: { hand: [], chips: 1015, bet: 0, spectating: false },
      others: [
        { nickname: '영희', handCount: 0, hand: [], chips: 1000, bet: 0, isTurn: false, spectating: false },
      ],
      dealer: { hand: [], hiddenCount: 0 },
    };
    const { lastFrame, stdin, unmount } = render(
      <BlackjackView {...baseProps({ view: bettingView, send })} />,
    );
    await tick();
    // 표시된 최대값 자체가 이미 10의 배수로 내림되어 있어야 한다. 칩 표시 자체는 1,015가
    // 맞으므로(다른 줄에 정상적으로 나온다) 베팅 힌트 줄만 골라서 검사한다.
    const betLine = (lastFrame() ?? '').split('\n').find((l) => l.includes('베팅액'));
    expect(betLine).toBeDefined();
    expect(betLine).toContain('1,010');
    expect(betLine).not.toContain('1,015');

    // ↑ 200번을 눌러도(과도하게 많이) 절대 1,015에 도달하지 않고 1,010에서 멈춘다.
    for (let i = 0; i < 200; i++) stdin.write(UP_ARROW);
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('bet', 1010);
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


  it('--ascii 테마에서 ASCII·한글 외 문자가 새지 않는다(베팅 화면 포함)', () => {
    // acting 화면
    const { lastFrame, unmount } = render(
      <BlackjackView {...baseProps({ theme: { unicode: false } })} />,
    );
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
    unmount();

    // betting 화면(↑↓/←→ 힌트가 테마별로 분기되는 지점)
    const bettingView = {
      phase: 'betting' as const,
      yourActions: ['bet'],
      you: { hand: [], chips: 1015, bet: 0, spectating: false },
      others: [
        { nickname: '영희', handCount: 0, hand: [], chips: 1000, bet: 0, isTurn: false, spectating: false },
      ],
      dealer: { hand: [], hiddenCount: 0 },
    };
    const { lastFrame: bettingFrame, unmount: unmountBetting } = render(
      <BlackjackView {...baseProps({ view: bettingView, theme: { unicode: false } })} />,
    );
    expect(findNonAsciiNonHangul(bettingFrame() ?? '')).toEqual([]);
    unmountBetting();
  });
});

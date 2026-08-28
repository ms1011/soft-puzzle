import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { YachtView } from '../src/ui/game/YachtView.js';
import type { GameViewProps } from '../src/ui/game/types.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function turnView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'turn' as const,
    yourActions: ['reroll', 'toggleHold', 'score'],
    turnPlayer: '철수',
    dice: [1, 2, 3, 4, 5],
    held: [true, false, false, false, false],
    rollsLeft: 2,
    players: [
      {
        nickname: '철수',
        sheet: { ones: 1, threes: 6 },
        upperTotal: 7,
        bonus: 0,
        total: 7,
        isTurn: true,
      },
      {
        nickname: '영희',
        sheet: {},
        upperTotal: 0,
        bonus: 0,
        total: 0,
        isTurn: false,
      },
    ],
    ...overrides,
  };
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return {
    view: turnView(),
    you: '철수',
    send: vi.fn(),
    theme: { unicode: true },
    ...overrides,
  };
}

describe('YachtView', () => {
  it('주사위 5개 아트와 홀드 이중선 표시를 그린다', () => {
    const { lastFrame, unmount } = render(<YachtView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    // held[0]=true인 유니코드 테마 주사위는 이중선(╔)으로 그려진다.
    expect(frame).toContain('╔');
    // held 아닌 나머지 주사위는 단일선(┌)으로 그려진다 — 대조.
    expect(frame).toContain('┌');
    expect(frame).toContain('남은 굴림');
    unmount();
  });

  it('점수표에 기록된 점수와 빈 칸을 함께 렌더한다', () => {
    const { lastFrame, unmount } = render(<YachtView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('철수');
    expect(frame).toContain('영희');
    // 철수는 ones=1을 기록했고, 영희는 전부 미기록(빈 칸 '-')이다.
    expect(frame).toContain('-');
    unmount();
  });

  it("1 입력이 send('toggleHold', 0)을 호출한다", async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<YachtView {...baseProps({ send })} />);
    await tick();
    stdin.write('1');
    await tick();
    expect(send).toHaveBeenCalledWith('toggleHold', 0);
    unmount();
  });

  it("rollsLeft가 0이면(yourActions에 reroll이 없으면) r 입력이 아무 것도 보내지 않는다", async () => {
    const send = vi.fn();
    const view = turnView({ rollsLeft: 0, yourActions: ['toggleHold', 'score'] });
    const { stdin, unmount } = render(<YachtView {...baseProps({ view, send })} />);
    await tick();
    stdin.write('r');
    await tick();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it("내 턴이 아니면(yourActions가 비어 있으면) 숫자 키를 눌러도 아무 것도 보내지 않는다", async () => {
    const send = vi.fn();
    const view = turnView({ yourActions: [], turnPlayer: '영희' });
    const { stdin, unmount } = render(<YachtView {...baseProps({ view, you: '철수', send })} />);
    await tick();
    stdin.write('1');
    await tick();
    stdin.write('r');
    await tick();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it("카테고리 선택 모드(c)에서 Enter로 send('score', 카테고리)를 보낸다", async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<YachtView {...baseProps({ send })} />);
    await tick();
    stdin.write('c');
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('score', expect.any(String));
    const [, cat] = send.mock.calls[0] as [string, string];
    // 철수는 ones/threes를 이미 기록했으니, 커서는 아직 안 쓴 첫 칸(twos)에서 시작해야 한다.
    expect(cat).not.toBe('ones');
    expect(cat).not.toBe('threes');
    unmount();
  });

  it('1인(솔로) 플레이도 예외 없이 렌더된다', () => {
    const view = turnView({ players: [turnView().players[0]] });
    expect(() => {
      const { unmount } = render(<YachtView {...baseProps({ view })} />);
      unmount();
    }).not.toThrow();
  });
});

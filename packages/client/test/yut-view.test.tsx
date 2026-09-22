import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { YutView } from '../src/ui/game/YutView.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { renderAtWidth, findNonAsciiNonHangul } from './testUtils.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

const HOME4 = [{ state: 'home' }, { state: 'home' }, { state: 'home' }, { state: 'home' }];

function throwView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'throw',
    yourActions: ['throw'],
    turnPlayer: '철수',
    throws: [],
    throwsLeft: 1,
    players: [
      {
        nickname: '철수',
        marker: 'A',
        pieces: [{ state: 'board', station: 3 }, { state: 'home' }, { state: 'home' }, { state: 'done' }],
        finished: 1,
        home: 2,
        isTurn: true,
      },
      {
        nickname: '영희',
        marker: 'B',
        pieces: [{ state: 'board', station: 22 }, { state: 'board', station: 22 }, { state: 'home' }, { state: 'home' }],
        finished: 0,
        home: 2,
        isTurn: false,
      },
    ],
    lastThrow: null,
    moves: [],
    ...overrides,
  };
}

/** 철수가 [걸][개]를 들고 있는 이동 단계. */
function moveView(overrides: Record<string, unknown> = {}) {
  return throwView({
    phase: 'move',
    yourActions: ['move'],
    throws: [
      { name: '걸', steps: 3 },
      { name: '개', steps: 2 },
    ],
    throwsLeft: 0,
    lastThrow: { player: '철수', name: '개', steps: 2, sticks: [true, true, false, false] },
    moves: [
      { throwIndex: 0, piece: 0, to: 6, stack: 1, capture: 0 },
      { throwIndex: 0, piece: 1, to: 3, stack: 1, capture: 0 },
      { throwIndex: 1, piece: 0, to: 5, stack: 1, capture: 0 },
      { throwIndex: 1, piece: 1, to: 2, stack: 1, capture: 0 },
    ],
    ...overrides,
  });
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return { view: throwView(), you: '철수', send: vi.fn(), theme: { unicode: true }, ...overrides };
}

describe('YutView', () => {
  it('윷판과 말 위치(업힌 수 포함), 범례를 그린다', () => {
    const { lastFrame, unmount } = render(<YutView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('◎');
    expect(frame).toContain('╲');
    expect(frame).toContain('╱');
    expect(frame).toMatch(/ A\s*$/m); // 걸 칸(3)의 철수 말(오른쪽 변)
    expect(frame).toContain('B2'); // 방에 업힌 영희의 말 2개
    expect(frame).toContain('철수 (나)');
    expect(frame).toContain('완주 1');
    expect(frame).toContain('Space 윷 던지기');
    unmount();
  });

  it('Space를 누르면 throw를 보낸다', async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<YutView {...baseProps({ send })} />);
    await tick();
    stdin.write(' ');
    await tick();
    expect(send).toHaveBeenCalledWith('throw');
    unmount();
  });

  it('이동 단계: Enter는 선택한 윷과 말로 move를 보낸다(←→ 윷, ↑↓ 말)', async () => {
    const send = vi.fn();
    const { stdin, lastFrame, unmount } = render(<YutView {...baseProps({ view: moveView(), send })} />);
    await tick();
    expect(lastFrame()).toContain('[걸] 말1 → * 칸');
    stdin.write('\u001B[C'); // → : [개]
    await tick();
    stdin.write('\u001B[B'); // ↓ : 두 번째 말(새 말)
    await tick();
    expect(lastFrame()).toContain('[개] 새 말 → * 칸');
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('move', { throwIndex: 1, piece: 1 });
    unmount();
  });

  it('기본 선택으로 Enter를 누르면 첫 윷·첫 말을 보낸다', async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<YutView {...baseProps({ view: moveView(), send })} />);
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('move', { throwIndex: 0, piece: 0 });
    unmount();
  });

  it('쓸 수 없는 윷(합법 수가 없는 빽도)은 ←→로 고를 수 없다', async () => {
    const send = vi.fn();
    const view = moveView({
      throws: [
        { name: '빽도', steps: -1 },
        { name: '도', steps: 1 },
      ],
      moves: [{ throwIndex: 1, piece: 1, to: 1, stack: 1, capture: 0 }],
    });
    const { stdin, unmount } = render(<YutView {...baseProps({ view, send })} />);
    await tick();
    stdin.write('\u001B[D');
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('move', { throwIndex: 1, piece: 1 });
    unmount();
  });

  it('내 차례가 아니면 아무 키에도 보내지 않는다', async () => {
    const send = vi.fn();
    const view = moveView({ yourActions: [], turnPlayer: '영희' });
    const { stdin, lastFrame, unmount } = render(<YutView {...baseProps({ view, send })} />);
    await tick();
    stdin.write(' ');
    stdin.write('\r');
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('영희님의 차례입니다.');
    unmount();
  });

  it('ascii 테마 출력은 ASCII와 한글만 쓴다', () => {
    for (const view of [throwView(), moveView()]) {
      const { lastFrame, unmount } = render(<YutView {...baseProps({ view, theme: { unicode: false } })} />);
      expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
      unmount();
    }
  });

  it('6인, 80칼럼에서도 줄바꿈 없이 그려진다', () => {
    const players = Array.from({ length: 6 }, (_, i) => ({
      nickname: i === 0 ? '가나다라마바사아자차카타파하' : `P${i}`,
      marker: 'ABCDEF'[i]!,
      pieces: i === 0 ? HOME4 : [{ state: 'board', station: i * 4 }, ...HOME4.slice(1)],
      finished: 0,
      home: i === 0 ? 4 : 3,
      isTurn: i === 0,
    }));
    for (const unicode of [true, false]) {
      const view = moveView({ players, turnPlayer: players[0]!.nickname });
      const { lastFrame, unmount } = renderAtWidth(
        <YutView view={view} you={players[0]!.nickname} send={() => {}} theme={{ unicode }} />,
        80,
      );
      const lines = (lastFrame() ?? '').split('\n');
      // 판 11줄 + 설명 1 + 빈 줄 + 범례 6 + 빈 줄 + 윷 2 + 빈 줄 + 안내 3 = 26줄.
      expect(lines.length).toBe(26);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
      expect(lines.some((l) => l.includes('P5'))).toBe(true);
      unmount();
    }
  });
});

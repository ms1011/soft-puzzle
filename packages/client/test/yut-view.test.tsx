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

  it('마지막 윷가락 4개를 배(평평한 면)·등으로 그리고 결과를 크게 알린다', () => {
    const { lastFrame, unmount } = render(<YutView {...baseProps({ view: moveView() })} />);
    const frame = lastFrame() ?? '';
    // 배 2개(가락 0·1), 등 2개(가락 2·3): 배는 빈 가락, 등은 채운 가락. 빽도 표시(x)는 0번 가락의
    // 배에 그려져 있어, 0번이 배를 보이면 결과가 빽도가 아니어도 보인다(실제 윷과 같다).
    expect(frame).toContain('│x│ │ │ │█│ │█│');
    expect(frame).toContain('철수: 개! (2칸)');
    unmount();
  });

  it('빽도는 표시 가락에 x를 그린다', () => {
    const view = moveView({ lastThrow: { player: '철수', name: '빽도', steps: -1, sticks: [true, false, false, false] } });
    const { lastFrame, unmount } = render(<YutView {...baseProps({ view })} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('│x│ │█│ │█│ │█│');
    expect(frame).toContain('빽도! (-1칸)');
    unmount();
  });

  it('윷·모는 한 번 더 던진다고 알린다', () => {
    const view = moveView({ lastThrow: { player: '철수', name: '모', steps: 5, sticks: [false, false, false, false] } });
    const { lastFrame, unmount } = render(<YutView {...baseProps({ view })} />);
    expect(lastFrame()).toContain('모! (5칸) 한 번 더!');
    unmount();
  });

  it('나온 윷에 칸 수를 붙인다', () => {
    const { lastFrame, unmount } = render(<YutView {...baseProps({ view: moveView() })} />);
    expect(lastFrame()).toContain('[걸 3] [개 2]');
    unmount();
  });

  it('도착 칸은 판에 *로 표시하고(잡는 칸도), 이름 있는 칸은 이름을 알려준다', () => {
    // 기본 선택: 걸(0번 윷)로 말1(3번 칸) → 6번 칸. 잡는 수로 바꿔 영희 말이 있는 22(방)로 보낸다.
    const view = moveView({ moves: [{ throwIndex: 0, piece: 0, to: 22, stack: 1, capture: 2 }] });
    const { lastFrame, unmount } = render(<YutView {...baseProps({ view })} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('*B2'); // 잡히는 영희 말 칸에도 도착 표시가 붙는다
    expect(frame).toContain('→ 방, 잡기!');
    unmount();
  });

  it('플레이어마다 말 4개를 완주·판·집 순서의 아이콘으로 보여준다', () => {
    // 철수: 판 1(3번 칸), 집 2, 완주 1 → ★●○○
    const { lastFrame, unmount } = render(<YutView {...baseProps()} />);
    expect((lastFrame() ?? '').split('\n').find((l) => l.includes('철수'))).toContain('★●○○');
    unmount();
  });

  it('판 오른쪽 변에 진행 방향(참먹이에서 위로)을 표시한다', () => {
    const uni = render(<YutView {...baseProps()} />);
    expect(uni.lastFrame()).toContain('↑');
    uni.unmount();
    const ascii = render(<YutView {...baseProps({ theme: { unicode: false } })} />);
    expect(ascii.lastFrame()).toContain('^');
    ascii.unmount();
  });

  it('선택한 이동이 지나가는 빈 칸을 판에 ·로 표시한다(도착 칸은 *)', () => {
    // 걸로 말1(3번 칸) → 4, 5, 6. 지나가는 4·5는 ·, 도착 6은 *.
    const view = moveView({ moves: [{ throwIndex: 0, piece: 0, to: 6, stack: 1, capture: 0, path: [4, 5, 6] }] });
    const { lastFrame, unmount } = render(<YutView {...baseProps({ view })} />);
    const board = (lastFrame() ?? '').split('\n').slice(0, 11).join('\n');
    expect(board.match(/·/g)).toHaveLength(2);
    expect(board).toContain('*');
    unmount();
  });

  it('이동 단계에서 고르는 수를 sendFocus로 보낸다', async () => {
    const sendFocus = vi.fn();
    const { unmount } = render(<YutView {...baseProps({ view: moveView(), sendFocus })} />);
    await tick();
    expect(sendFocus).toHaveBeenCalledWith({ throwIndex: 0, piece: 0 });
    unmount();
  });

  it('다른 사람이 고민 중인 수의 경로·도착 칸을 판에 보여주고 문장으로 알린다', () => {
    const view = moveView({ yourActions: [], turnPlayer: '영희', moves: [] });
    const focus = { 영희: { throwIndex: 0, piece: 0, to: 27, path: [27] } };
    const { lastFrame, unmount } = render(<YutView {...baseProps({ view, focus })} />);
    const frame = lastFrame() ?? '';
    expect(frame.split('\n').slice(0, 11).join('\n')).toContain('*');
    expect(frame).toContain('영희님이 [걸] 말1(2개) → * 칸 고민 중');
    unmount();
  });

  it('다른 사람이 내 말이 있는 칸을 노리면 경고한다', () => {
    // 철수(나)의 말1은 3번 칸에 있다.
    const view = moveView({ yourActions: [], turnPlayer: '영희', moves: [] });
    const focus = { 영희: { throwIndex: 1, piece: 2, to: 3, path: [1, 2, 3] } };
    const { lastFrame, unmount } = render(<YutView {...baseProps({ view, focus })} />);
    expect(lastFrame()).toContain('영희님이 [개] 새 말 → * 칸 고민 중 (내 말을 잡을 수 있습니다!)');
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
      // 판 11줄 + 설명 1 + 빈 줄 + 범례 6(마지막 윷가락은 범례 오른쪽) + 빈 줄 + 윷 1 + 빈 줄 + 안내 3 = 25줄.
      expect(lines.length).toBe(25);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
      expect(lines.some((l) => l.includes('P5'))).toBe(true);
      unmount();
    }
  });
});

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { LasVegasView } from '../src/ui/game/LasVegasView.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { renderAtWidth, findNonAsciiNonHangul } from './testUtils.js';
import { displayWidth } from '../src/art/width.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'place' as const,
    yourActions: ['place'],
    round: 2,
    totalRounds: 4,
    turnPlayer: '철수',
    dice: [5, 2, 2, 6, 5, 5, 1, 3],
    casinos: [
      { number: 1, bills: [60, 10], dice: [{ nickname: '영희', count: 2 }] },
      { number: 2, bills: [50], dice: [] },
      { number: 3, bills: [30, 20], dice: [{ nickname: '철수', count: 1 }, { nickname: '영희', count: 1 }] },
      { number: 4, bills: [90], dice: [] },
      { number: 5, bills: [40, 10], dice: [] },
      { number: 6, bills: [70], dice: [] },
    ],
    players: [
      { nickname: '철수', diceLeft: 8, money: 130, bills: 2, isTurn: true },
      { nickname: '영희', diceLeft: 5, money: 90, bills: 1, isTurn: false },
    ],
    lastPayout: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return { view: makeView(), you: '철수', send: vi.fn(), theme: { unicode: true }, ...overrides };
}

describe('LasVegasView', () => {
  it('라운드·주사위·카지노 지폐·주사위 수·플레이어 돈을 그린다', () => {
    const { lastFrame, unmount } = render(<LasVegasView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('라운드 2/4');
    expect(frame).toContain('내 차례');
    expect(frame).toContain('┌'); // 주사위 아트
    expect(frame).toContain('╔'); // 선택된 눈(5, 가장 많음)은 이중선
    expect(frame).toContain('[5]');
    expect(frame).toContain('$90,000');
    expect(frame).toContain('$60,000');
    expect(frame).toContain('4번');
    expect(frame).not.toContain('4번 [4]'); // 머리글의 번호 중복을 없앴다
    expect(frame).toContain('1번 2개'); // 대신 그 카지노에 놓인 주사위 총수
    expect(frame).toContain('$130,000');
    expect(frame).toContain('철수 (나)');
    expect(frame).toContain('주사위 5개');
    unmount();
  });

  it('Enter는 선택한 눈(기본: 가장 많이 나온 눈)으로 place를 보낸다', async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<LasVegasView {...baseProps({ send })} />);
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('place', 5);
    unmount();
  });

  it('숫자 키로 굴린 눈을 고르고, 굴리지 않은 눈은 무시한다', async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<LasVegasView {...baseProps({ send })} />);
    await tick();
    stdin.write('4'); // 굴리지 않음 → 선택 유지(5)
    await tick();
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('place', 2);
    expect(send).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('←/→로 굴린 눈 사이를 순환한다', async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<LasVegasView {...baseProps({ send })} />);
    await tick();
    stdin.write('\u001B[C'); // → : 5 → 6
    await tick();
    stdin.write('\u001B[C'); // → : 6 → 1 (순환)
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenLastCalledWith('place', 1);
    stdin.write('\u001B[D'); // ← : 1 → 6
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenLastCalledWith('place', 6);
    unmount();
  });

  it('내 차례가 아니면 아무것도 보내지 않는다', async () => {
    const send = vi.fn();
    const view = makeView({ yourActions: [], turnPlayer: '영희' });
    const { stdin, lastFrame, unmount } = render(<LasVegasView {...baseProps({ view, send })} />);
    await tick();
    expect(lastFrame()).toContain('영희님의 차례');
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it('카지노 칸마다 지금 받게 될 지폐를 적고, 동수는 무효로 표시한다', () => {
    const view = makeView({ yourActions: [], turnPlayer: '영희' });
    const { lastFrame, unmount } = render(<LasVegasView {...baseProps({ view })} />);
    const lines = (lastFrame() ?? '').split('\n');
    // 1번: 영희 2개 단독 → 가장 큰 지폐 $60k. 3번: 철수 1 · 영희 1 동수 → 둘 다 무효.
    expect(lines.some((l) => /영희\s+2 \$60k/.test(l))).toBe(true);
    expect(lines.some((l) => /\(나\)\s+1 무효/.test(l))).toBe(true);
    unmount();
  });

  it('고른 눈의 카지노에 걸었을 때의 결과를 미리 보여준다', () => {
    // 기본 선택은 가장 많이 나온 5(3개). 5번 카지노는 비어 있어 가장 큰 지폐 $40,000을 받는다.
    const { lastFrame, unmount } = render(<LasVegasView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('5번에 3개 걸면 → $40,000');
    expect(frame).toContain('5번 +3');
    expect(frame.split('\n').some((l) => /\(나\)\s+3 \$40k/.test(l))).toBe(true);
    unmount();
  });

  it('걸면 동수가 되는 경우 무효라고 미리 알린다', async () => {
    const view = makeView({
      casinos: makeView().casinos.map((c) => (c.number === 2 ? { ...c, dice: [{ nickname: '영희', count: 2 }] } : c)),
    });
    const { lastFrame, stdin, unmount } = render(<LasVegasView {...baseProps({ view })} />);
    await tick();
    stdin.write('2'); // 2는 두 개 나왔다 → 영희 2개와 동수
    await tick();
    expect(lastFrame()).toContain('2번에 2개 걸면 → 무효 (영희와 동수)');
    unmount();
  });

  it('플레이어는 가진 돈 순으로 순위를 붙여 보여준다', () => {
    const view = makeView({
      players: [
        { nickname: '철수', diceLeft: 8, money: 90, bills: 1, isTurn: true },
        { nickname: '영희', diceLeft: 5, money: 130, bills: 2, isTurn: false },
      ],
    });
    const { lastFrame, unmount } = render(<LasVegasView {...baseProps({ view })} />);
    const lines = (lastFrame() ?? '').split('\n');
    const first = lines.findIndex((l) => l.includes('1위'));
    const second = lines.findIndex((l) => l.includes('2위'));
    expect(lines[first]).toContain('영희');
    expect(lines[second]).toContain('철수');
    expect(first).toBeLessThan(second);
    unmount();
  });

  it('지난 라운드 정산을 카지노별로 한 줄에 보여준다', () => {
    const view = makeView({
      lastPayout: [
        { casino: 1, awards: [{ nickname: '영희', bill: 60 }] },
        { casino: 3, awards: [{ nickname: '철수', bill: 90 }, { nickname: '영희', bill: 20 }] },
      ],
    });
    const { lastFrame, unmount } = render(<LasVegasView {...baseProps({ view })} />);
    const line = (lastFrame() ?? '').split('\n').find((l) => l.includes('지난 정산'))!;
    expect(line).toContain('1번 영희 $60k');
    expect(line).toContain('3번 (나) $90k, 영희 $20k');
    unmount();
  });

  it('ascii 테마 출력은 ASCII·한글만 쓴다', () => {
    const { lastFrame, unmount } = render(<LasVegasView {...baseProps({ theme: { unicode: false } })} />);
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
    unmount();
    const other = render(
      <LasVegasView {...baseProps({ theme: { unicode: false }, view: makeView({ yourActions: [], turnPlayer: '영희' }) })} />,
    );
    expect(findNonAsciiNonHangul(other.lastFrame() ?? '')).toEqual([]);
    other.unmount();
  });

  it('6인·긴 닉네임이어도 80칼럼에서 줄이 넘치거나 접히지 않는다', () => {
    const longNick = '가나다라마바사아자차카타파하가나';
    const names = [longNick, 'Player_Two_Long', '민수', '지영', 'abcdefghijkl', '하나'];
    const view = makeView({
      turnPlayer: longNick,
      dice: [1, 2, 3, 4, 5, 6, 6, 6],
      casinos: [1, 2, 3, 4, 5, 6].map((n) => ({
        number: n,
        bills: [10, 10, 10, 10, 10],
        dice: names.map((nickname, i) => ({ nickname, count: i + 1 })),
      })),
      players: names.map((nickname, i) => ({
        nickname,
        diceLeft: 8,
        money: 1230,
        bills: 12,
        isTurn: i === 0,
      })),
      lastPayout: [{ casino: 1, awards: names.map((nickname) => ({ nickname, bill: 90 })) }],
    });
    const { lastFrame, unmount } = renderAtWidth(
      <LasVegasView view={view} you={longNick} send={() => {}} theme={{ unicode: true }} />,
      80,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(80);
    // 헤더 1 + 빈 줄 + 주사위 6 + 빈 줄 + 카지노(머리 1 + 지폐 5 + 구분선 1 + 주사위 6) + 지난 정산 1
    // + 빈 줄 + 플레이어 6 + 빈 줄 + 힌트 1 = 32줄. 접힌 줄이 하나라도 있으면 어긋난다.
    expect(lines.length).toBe(32);
    expect(frame).not.toContain(longNick);
    // 한 카지노 칸 안에 6명 전원이 각자 한 줄로 들어가 있다.
    expect(lines.filter((l) => l.includes('(나)')).length).toBeGreaterThan(0);
    unmount();
  });
});

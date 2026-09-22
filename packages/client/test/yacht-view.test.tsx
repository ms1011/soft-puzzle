import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { scoreCategory } from '@soft-puzzle/core';
import { YachtView } from '../src/ui/game/YachtView.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { renderAtWidth, findNonAsciiNonHangul } from './testUtils.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
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

  it('차례인 사람의 빈 칸에만 지금 주사위로 받을 점수를 (괄호)로 미리 보여준다', () => {
    const { lastFrame, unmount } = render(<YachtView {...baseProps()} />);
    const lines = (lastFrame() ?? '').split('\n');
    const expected = scoreCategory([1, 2, 3, 4, 5], 'largeStraight');
    const largeLine = lines.find((line) => line.includes('L.스트레이트'))!;
    expect(largeLine).toContain(`(${expected})`);
    // 영희는 차례가 아니므로 미리보기 없이 빈 칸('-') 그대로다 — 괄호는 한 번만 나온다.
    expect(largeLine.match(/\(/g)).toHaveLength(1);
    // 이미 기록한 칸(철수 ones=1)은 미리보기가 아니라 기록된 점수다.
    const onesLine = lines.find((line) => line.includes('1(에이스)'))!;
    expect(onesLine).not.toContain('(1)');
    unmount();
  });

  it('남은 굴림을 점으로도 보여준다', () => {
    const view = turnView({ rollsLeft: 1 });
    const { lastFrame, unmount } = render(<YachtView {...baseProps({ view })} />);
    expect(lastFrame()).toContain('●○');
    unmount();
  });

  it('차례인 다른 사람이 고민 중인 칸을 점수표와 문구로 보여주고, 표 줄 수는 그대로다', () => {
    const view = turnView({
      yourActions: [],
      turnPlayer: '영희',
      players: turnView().players.map((p) => ({ ...p, isTurn: p.nickname === '영희' })),
    });
    const plain = render(<YachtView {...baseProps({ view })} />);
    const focused = render(<YachtView {...baseProps({ view, focus: { 영희: { category: 'fullHouse' } } })} />);
    const frame = focused.lastFrame() ?? '';
    expect(frame).toContain('풀하우스 칸을 고민 중');
    expect(frame.split('\n').find((l) => l.includes('풀하우스') && !l.includes('고민'))).toContain('▶');
    expect(frame.split('\n').length).toBe((plain.lastFrame() ?? '').split('\n').length);
    plain.unmount();
    focused.unmount();
  });

  it('점수 칸 선택 모드에서 커서 칸을 sendFocus로 보내고, 모드를 나가면 null을 보낸다', async () => {
    const sendFocus = vi.fn();
    const { stdin, unmount } = render(<YachtView {...baseProps({ sendFocus })} />);
    await tick();
    stdin.write('c');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sendFocus).toHaveBeenLastCalledWith({ category: 'twos' }); // 철수는 ones를 이미 기록했다
    stdin.write('\u001B');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sendFocus).toHaveBeenLastCalledWith(null);
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


  it('3인, 80칼럼에서도 점수표가 줄바꿈으로 깨지지 않는다(회귀)', () => {
    // 리뷰 실측: 예전엔 3인+80칼럼에서 표 행 사이에 빈 줄이 끼며 깨졌다. 표가 안 깨졌다면
    // 줄 수가 정확히 19줄(주사위 6줄 + 표 17줄 중 더 큰 쪽 17줄 + 힌트 줄 1줄 + 빈 줄 1줄)로
    // 고정된다 — 줄바꿈이 하나라도 끼어들면 이 수가 어긋난다.
    const view = turnView({
      players: [
        { nickname: '철수', sheet: {}, upperTotal: 0, bonus: 0, total: 0, isTurn: true },
        { nickname: '영희', sheet: {}, upperTotal: 0, bonus: 0, total: 0, isTurn: false },
        { nickname: '민수', sheet: {}, upperTotal: 0, bonus: 0, total: 0, isTurn: false },
      ],
    });
    const { lastFrame, unmount } = renderAtWidth(
      <YachtView view={view} you="철수" send={() => {}} theme={{ unicode: true }} />,
      80,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    expect(lines.length).toBe(19);
    // 표의 마지막 행(총점)이 여전히 온전한 한 줄로 존재해야 한다 — 줄바꿈이 끼었다면
    // '총점'과 그 뒤 숫자들이 서로 다른 줄로 쪼개져 이 줄에 함께 나타나지 않는다.
    const totalLine = lines.find((l) => l.includes('총점'));
    expect(totalLine).toBeDefined();
    expect(totalLine).toContain('0');
    unmount();
  });

  it('6인, 100칼럼에서도 점수표가 줄바꿈으로 깨지지 않는다(회귀)', () => {
    const view = turnView({
      players: Array.from({ length: 6 }, (_, i) => ({
        nickname: `P${i}`,
        sheet: {},
        upperTotal: 0,
        bonus: 0,
        total: 0,
        isTurn: i === 0,
      })),
    });
    const { lastFrame, unmount } = renderAtWidth(
      <YachtView view={view} you="P0" send={() => {}} theme={{ unicode: true }} />,
      100,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    expect(lines.length).toBe(19);
    const totalLine = lines.find((l) => l.includes('총점'));
    expect(totalLine).toBeDefined();
    // 6명 전원의 칸이 이 한 줄에 다 있어야 한다(줄바꿈으로 흩어지지 않았다는 뜻).
    for (let i = 0; i < 6; i++) expect(totalLine).toContain('0');
    unmount();
  });

  it('닉네임 하나가 32자로 길어도(회귀: 예전엔 표 전체 폭이 그 닉네임 하나에 끌려갔다) 표가 100칼럼에서 안 깨진다', () => {
    const longNick = '가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라'.slice(0, 32);
    const view = turnView({
      turnPlayer: longNick,
      players: [
        { nickname: longNick, sheet: {}, upperTotal: 0, bonus: 0, total: 0, isTurn: true },
        ...Array.from({ length: 5 }, (_, i) => ({
          nickname: `P${i}`,
          sheet: {},
          upperTotal: 0,
          bonus: 0,
          total: 0,
          isTurn: false,
        })),
      ],
    });
    const { lastFrame, unmount } = renderAtWidth(
      <YachtView view={view} you={longNick} send={() => {}} theme={{ unicode: true }} />,
      100,
    );
    const frame = lastFrame() ?? '';
    expect(frame.split('\n').length).toBe(19);
    // 긴 닉네임 자체는 잘려서 보여야 한다(전체가 그대로 나오면 표를 부풀렸다는 뜻).
    expect(frame).not.toContain(longNick);
    unmount();
  });

  it('회귀: 라벨이 긴 두 행(S.스트레이트/L.스트레이트)도 다른 행과 같은 칼럼에서 점수 칸이 시작한다', () => {
    // 예전엔 카테고리 행이 padDisplay(label, labelWidth - 1)로 패딩해 12칼럼 라벨(S/L
    // 스트레이트)이 정확히 한 칸을 넘쳐 그 행만 점수 칸이 한 칼럼 오른쪽으로 밀렸다.
    const view = turnView({
      players: [
        {
          nickname: '철수',
          sheet: { chance: 23, largeStraight: 40 },
          upperTotal: 0,
          bonus: 0,
          total: 63,
          isTurn: true,
        },
        { nickname: '영희', sheet: {}, upperTotal: 0, bonus: 0, total: 0, isTurn: false },
      ],
    });
    const { lastFrame, unmount } = render(<YachtView {...baseProps({ view })} />);
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');

    const chanceLine = lines.find((l) => l.includes('찬스'));
    const largeStraightLine = lines.find((l) => l.includes('L.스트레이트'));
    expect(chanceLine).toBeDefined();
    expect(largeStraightLine).toBeDefined();

    // 두 행 모두에서 "철수" 칸의 값(23, 40)이 시작하는 표시 칼럼이 같아야 한다. 값 앞의
    // 부분을 displayWidth로 재서 비교한다 — 원 문자열의 code-unit index가 아니라 실제
    // 터미널 칼럼으로 비교해야 한글 라벨 길이 차이에 흔들리지 않는다.
    function colOf(line: string, needle: string): number {
      const idx = line.indexOf(needle);
      expect(idx).toBeGreaterThanOrEqual(0);
      return [...line.slice(0, idx)].reduce((w, ch) => {
        const cp = ch.codePointAt(0) ?? 0;
        const wide = (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0xac00 && cp <= 0xd7a3);
        return w + (wide ? 2 : 1);
      }, 0);
    }

    expect(colOf(largeStraightLine!, '40')).toBe(colOf(chanceLine!, '23'));
    unmount();
  });

  it('--ascii 테마에서 ASCII·한글 외 문자가 새지 않는다', () => {
    const view = turnView({
      players: [
        { nickname: '철수', sheet: { ones: 1, largeStraight: 40 }, upperTotal: 1, bonus: 0, total: 41, isTurn: true },
        { nickname: '영희', sheet: {}, upperTotal: 0, bonus: 0, total: 0, isTurn: false },
      ],
    });
    const { lastFrame, unmount } = render(
      <YachtView {...baseProps({ view, theme: { unicode: false } })} />,
    );
    const frame = lastFrame() ?? '';
    expect(findNonAsciiNonHangul(frame)).toEqual([]);
    unmount();
  });
});

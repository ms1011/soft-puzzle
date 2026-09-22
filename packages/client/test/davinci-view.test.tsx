import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { DavinciView, guessStrip, renderTileRow } from '../src/ui/game/DavinciView.js';
import { renderTile } from '../src/art/tiles.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { findNonAsciiNonHangul } from './testUtils.js';

const ESC = '\u001B';
const DOWN = `${ESC}[B`;
const RIGHT = `${ESC}[C`;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function davinciView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'guessing',
    yourActions: ['guess'],
    isTurn: true,
    turnPlayer: '철수',
    boards: [
      { nickname: '철수', eliminated: false, tiles: [{ value: 1, revealed: false }, { value: 5, revealed: true }, { value: 9, revealed: false }] },
      { nickname: '영희', eliminated: false, tiles: [{ value: null, revealed: false }, { value: 4, revealed: true }, { value: null, revealed: false }] },
    ],
    ...overrides,
  };
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return { view: davinciView(), you: '철수', send: vi.fn(), theme: { unicode: true }, ...overrides };
}

describe('renderTile', () => {
  it('숨김 타일은 뒷면, 공개 타일은 이중선, 모두 4칸×3줄', () => {
    expect(renderTile(null, 'hidden', { unicode: true })).toEqual(['┌──┐', '│▒▒│', '└──┘']);
    expect(renderTile(11, 'revealed', { unicode: true })).toEqual(['╔══╗', '║11║', '╚══╝']);
    expect(renderTile(3, 'mine', { unicode: true })).toEqual(['┌──┐', '│ 3│', '└──┘']);
  });

  it('ascii 테마는 순수 ASCII다', () => {
    const all = [renderTile(null, 'hidden', { unicode: false }), renderTile(7, 'revealed', { unicode: false })].flat().join('');
    expect(/^[\x20-\x7e]*$/.test(all)).toBe(true);
  });
});

describe('renderTileRow', () => {
  it('선택한 타일만 한 줄 위로 들어 올리고 번호 줄을 붙인다', () => {
    const tiles = [{ value: null, revealed: false }, { value: null, revealed: false }];
    const rows = renderTileRow(tiles, 1, { unicode: true });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.map((s) => s.text.trim())).toEqual(['', '┌──┐']); // 선택된 2번만 맨 윗줄에 있다
    expect(rows[1]!.map((s) => s.text.trim())).toEqual(['┌──┐', '│▒▒│']);
    expect(rows[4]!.map((s) => s.text.trim())).toEqual(['1', '2']);
    expect(rows[0]!.map((s) => s.selected)).toEqual([false, true]);
  });
});

describe('guessStrip', () => {
  it('고른 숫자만 괄호로 감싼다', () => {
    expect(guessStrip(3)).toContain('[3]');
    expect(guessStrip(3)).not.toContain('[4]');
    expect(guessStrip(11)).toContain('[11]');
  });
});

describe('DavinciView', () => {
  it('타일을 아트로 그리고, 내 숨김 타일 숫자와 상대 공개 타일 숫자를 보여준다', () => {
    const { lastFrame, unmount } = render(<DavinciView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▒▒');
    expect(frame).toContain('║ 4║');
    expect(frame).toContain('│ 9│');
    unmount();
  });

  it('겨누고 있는 대상 타일과 숫자를 화면에 표시한다(예전엔 보드에 아무 강조가 없었다)', async () => {
    const { lastFrame, stdin, unmount } = render(<DavinciView {...baseProps()} />);
    await tick();
    expect(lastFrame()).toContain('영희님의 1번 타일');
    stdin.write(DOWN);
    await tick();
    expect(lastFrame()).toContain('영희님의 3번 타일'); // 공개된 2번은 건너뛴다
    unmount();
  });

  it('←→로 숫자를 고르고 Enter로 guess를 보낸다', async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<DavinciView {...baseProps({ send })} />);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(RIGHT);
    await tick();
    stdin.write(RIGHT);
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('guess', { player: '영희', index: 2, value: 2 });
    unmount();
  });

  it('내 차례가 아니면 누가 추리 중인지와 차례 표시를 보여준다', () => {
    const view = davinciView({ yourActions: [], isTurn: false, turnPlayer: '영희' });
    const { lastFrame, unmount } = render(<DavinciView {...baseProps({ view })} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('영희님이 추리 중입니다.');
    expect(frame).toContain('◀ 영희');
    unmount();
  });

  it('--ascii 테마에서 ASCII·한글 외 문자가 새지 않는다', () => {
    const { lastFrame, unmount } = render(<DavinciView {...baseProps({ theme: { unicode: false } })} />);
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
    unmount();
  });
});

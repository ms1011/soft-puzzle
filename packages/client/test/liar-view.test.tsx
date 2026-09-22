import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { LiarView } from '../src/ui/game/LiarView.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { findNonAsciiNonHangul } from './testUtils.js';

const DOWN = '\u001B[B';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function liarView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'voting',
    yourActions: ['vote'],
    yourWord: '바다',
    players: ['철수', '영희', '민수'],
    hasVoted: false,
    voted: ['영희'],
    ...overrides,
  };
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return { view: liarView(), you: '철수', send: vi.fn(), theme: { unicode: true }, ...overrides };
}

describe('LiarView', () => {
  it('제시어를 상자 안에 보여준다', () => {
    const { lastFrame, unmount } = render(<LiarView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('제시어: 바다');
    expect(frame).toContain('╭');
    unmount();
  });

  it('라이어에게는 제시어 대신 ???를 보여준다', () => {
    const view = liarView({ yourWord: '라이어 (제시어를 모릅니다)' });
    const { lastFrame, unmount } = render(<LiarView {...baseProps({ view })} />);
    expect(lastFrame()).toContain('당신은 라이어입니다. 제시어: ???');
    unmount();
  });

  it('투표를 마친 사람과 진행 수를 보여준다', () => {
    const { lastFrame, unmount } = render(<LiarView {...baseProps()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('투표 1/3명');
    expect(frame.split('\n').find((l) => l.includes('영희'))).toContain('투표 완료');
    expect(frame.split('\n').find((l) => l.includes('민수'))).not.toContain('투표 완료');
    unmount();
  });

  it('↓로 대상을 옮기고 Enter로 투표한다(나는 대상에서 빠진다)', async () => {
    const send = vi.fn();
    const { stdin, unmount } = render(<LiarView {...baseProps({ send })} />);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write('\r');
    await tick();
    expect(send).toHaveBeenCalledWith('vote', '민수');
    unmount();
  });

  it('--ascii 테마에서 ASCII·한글 외 문자가 새지 않는다', () => {
    const { lastFrame, unmount } = render(<LiarView {...baseProps({ theme: { unicode: false } })} />);
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
    unmount();
  });
});

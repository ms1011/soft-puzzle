import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { MafiaView } from '../src/ui/game/MafiaView.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { findNonAsciiNonHangul } from './testUtils.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function nightView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'night',
    yourActions: ['mafiaVote'],
    yourRole: 'mafia',
    phaseLabel: '밤',
    alive: [
      { nickname: '철수', alive: true },
      { nickname: '영희', alive: true },
      { nickname: '민수', alive: true },
      { nickname: '지민', alive: false, role: 'citizen' },
    ],
    hasActed: false,
    ...overrides,
  };
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return { view: nightView(), you: '철수', send: vi.fn(), theme: { unicode: true }, ...overrides };
}

describe('MafiaView', () => {
  it('동료 마피아의 조준을 대상 옆에 표시한다', () => {
    const { lastFrame, unmount } = render(<MafiaView {...baseProps({ focus: { 영희: { target: '민수' } } })} />);
    const line = (lastFrame() ?? '').split('\n').find((l) => l.includes('민수'))!;
    expect(line).toContain('동료 영희 조준');
    unmount();
  });

  it('밤에 마피아로 고르는 대상을 sendFocus로 보낸다', async () => {
    const sendFocus = vi.fn();
    const { unmount } = render(<MafiaView {...baseProps({ sendFocus })} />);
    await tick();
    expect(sendFocus).toHaveBeenCalledWith({ target: '영희' });
    unmount();
  });

  it('낮 투표 커서는 보내지 않는다', async () => {
    const sendFocus = vi.fn();
    const view = nightView({ phase: 'day', phaseLabel: '낮', yourActions: ['vote'] });
    const { unmount } = render(<MafiaView {...baseProps({ view, sendFocus })} />);
    await tick();
    expect(sendFocus).not.toHaveBeenCalled();
    unmount();
  });

  it('--ascii 테마에서 ASCII·한글 외 문자가 새지 않는다', () => {
    const { lastFrame, unmount } = render(
      <MafiaView {...baseProps({ theme: { unicode: false }, focus: { 영희: { target: '민수' } } })} />,
    );
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
    unmount();
  });
});

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

  it('일차와 밤·낮을 헤더에 보여준다', () => {
    const { lastFrame, unmount } = render(<MafiaView {...baseProps({ view: nightView({ day: 2 }) })} />);
    expect(lastFrame()).toContain('2일차 밤');
    unmount();
  });

  it('동료 마피아에게 표시를 붙인다(나 자신에게는 붙이지 않는다)', () => {
    const view = nightView({
      alive: [
        { nickname: '철수', alive: true, role: 'mafia' },
        { nickname: '영희', alive: true, role: 'mafia' },
        { nickname: '민수', alive: true },
      ],
    });
    const { lastFrame, unmount } = render(<MafiaView {...baseProps({ view })} />);
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines.find((l) => l.includes('영희'))).toContain('[동료 마피아]');
    expect(lines.find((l) => l.includes('철수'))).not.toContain('[동료 마피아]');
    unmount();
  });

  it('낮에는 투표를 마친 사람과 진행 수를 보여준다', () => {
    const view = nightView({ phase: 'day', phaseLabel: '낮', day: 1, yourActions: ['vote'], voted: ['영희'] });
    const { lastFrame, unmount } = render(<MafiaView {...baseProps({ view })} />);
    const frame = lastFrame() ?? '';
    expect(frame.split('\n').find((l) => l.includes('영희'))).toContain('투표 완료');
    expect(frame).toContain('투표 1/3명');
    unmount();
  });

  it('--ascii 테마에서 낮 투표 화면도 ASCII·한글 외 문자가 새지 않는다', () => {
    const view = nightView({ phase: 'day', phaseLabel: '낮', day: 1, yourActions: ['vote'], voted: ['영희'] });
    const { lastFrame, unmount } = render(<MafiaView {...baseProps({ view, theme: { unicode: false } })} />);
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
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

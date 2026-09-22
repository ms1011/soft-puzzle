import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TurnTimer, timerBar } from '../src/ui/game/TurnTimer.js';
import { findNonAsciiNonHangul } from './testUtils.js';

describe('timerBar', () => {
  it('남은 비율만큼 채운 10칸 막대를 그린다', () => {
    expect(timerBar(45, 90, { unicode: true })).toBe('█████░░░░░');
    expect(timerBar(90, 90, { unicode: true })).toBe('██████████');
    expect(timerBar(0, 90, { unicode: true })).toBe('░░░░░░░░░░');
  });

  it('남은 시간이 조금이라도 있으면 최소 한 칸은 채운다', () => {
    expect(timerBar(1, 90, { unicode: true })).toBe('█░░░░░░░░░');
  });

  it('ascii 테마는 [#---] 형태의 순수 ASCII 막대다', () => {
    expect(timerBar(45, 90, { unicode: false })).toBe('[#####-----]');
  });
});

describe('TurnTimer', () => {
  it('막대와 남은 초를 보여준다', () => {
    const { lastFrame, unmount } = render(<TurnTimer deadline={Date.now() + 45_000} theme={{ unicode: true }} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('█');
    expect(frame).toMatch(/4[45]초/);
    unmount();
  });

  it('ascii 테마에서는 ASCII·한글 외 문자가 새지 않는다(예전엔 ⏱가 그대로 나왔다)', () => {
    const { lastFrame, unmount } = render(<TurnTimer deadline={Date.now() + 10_000} theme={{ unicode: false }} />);
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
    unmount();
  });
});

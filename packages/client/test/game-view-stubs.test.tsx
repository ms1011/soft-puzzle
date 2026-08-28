import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { BlackjackView } from '../src/ui/game/BlackjackView.js';
import { OneCardView } from '../src/ui/game/OneCardView.js';
import { YachtView } from '../src/ui/game/YachtView.js';
import type { GameViewProps } from '../src/ui/game/types.js';

/**
 * 결정 1: 세 게임 화면은 지금 스텁이다(Task 13~15가 실제 화면으로 교체한다). 여기서는 계약된
 * props({view, you, send, theme})로 예외 없이 렌더되고, 한국어 "준비 중" 안내를 보여주는지만
 * 확인한다 — App이 화면 라우팅 맵에서 이 모듈들을 import할 수 있어야 한다는 최소 보장이다.
 */
const props: GameViewProps = {
  view: { phase: 'playing', yourActions: [] },
  you: '철수',
  send: () => {},
  theme: { unicode: true },
};

describe('게임 화면 스텁', () => {
  it('BlackjackView는 준비 중 안내를 렌더한다', () => {
    const { lastFrame, unmount } = render(<BlackjackView {...props} />);
    expect(lastFrame() ?? '').toContain('준비 중');
    unmount();
  });

  it('OneCardView는 준비 중 안내를 렌더한다', () => {
    const { lastFrame, unmount } = render(<OneCardView {...props} />);
    expect(lastFrame() ?? '').toContain('준비 중');
    unmount();
  });

  it('YachtView는 준비 중 안내를 렌더한다', () => {
    const { lastFrame, unmount } = render(<YachtView {...props} />);
    expect(lastFrame() ?? '').toContain('준비 중');
    unmount();
  });
});

import type { GameView } from '@soft-puzzle/core';
import type { Theme } from '../../art/theme.js';

/**
 * 게임 화면 플러그인 규약(브리프 §Interfaces) — App이 state.room.game에 따라 이 props로 각 게임
 * View를 렌더링한다. Task 13~15가 각 게임의 실제 화면(BlackjackView/OneCardView/YachtView)을
 * 이 계약대로 구현한다 — 여기서는 타입만 고정한다.
 */
export interface GameViewProps {
  view: GameView;
  you: string;
  send: (name: string, arg?: unknown) => void;
  theme: Theme;
}

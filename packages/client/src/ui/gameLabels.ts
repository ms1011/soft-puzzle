import type { GameId } from '@card-night/core';

/** 게임 id → 한국어 표시 이름. MainMenu·RoomList·Lobby·타이틀 바가 모두 이 매핑을 공유한다. */
export const GAME_LABELS: Record<GameId, string> = {
  blackjack: '블랙잭',
  onecard: '원카드',
  yacht: '야추',
};

export const GAME_IDS: readonly GameId[] = ['blackjack', 'onecard', 'yacht'];

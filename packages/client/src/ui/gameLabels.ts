import type { GameId } from '@card-night/core';

/** 게임 id → 한국어 표시 이름. MainMenu·RoomList·Lobby·타이틀 바가 모두 이 매핑을 공유한다. */
export const GAME_LABELS: Record<GameId, string> = {
  blackjack: '블랙잭',
  onecard: '원카드',
  yacht: '야추',
};

export const GAME_IDS: readonly GameId[] = ['blackjack', 'onecard', 'yacht'];

/**
 * 게임 액션 이름 → 한국어 표시 라벨. 세 엔진이 실제로 내보내는 action name과 로비/결과의
 * 공통 action name을 모두 미리 채워둔다 — Task 13~15가 이 기본값을 그대로 물려받고, ActionBar
 * 계약(labels에 없는 액션은 이름 자체로 폴백)은 그대로 안전망으로 남는다.
 */
export const ACTION_LABELS: Record<string, string> = {
  // 로비/결과 공통
  start: '시작',
  replay: '다시하기',
  toLobby: '로비로',
  // 블랙잭
  bet: '베팅',
  hit: '히트',
  stand: '스탠드',
  double: '더블다운',
  ready: '준비',
  endGame: '게임 종료',
  // 야추
  toggleHold: '홀드',
  reroll: '리롤',
  score: '점수 기록',
  // 원카드
  play: '내기',
  draw: '뽑기',
};

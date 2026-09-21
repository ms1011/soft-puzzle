import type { GameId } from '@soft-puzzle/core';

/** 게임 id → 한국어 표시 이름. MainMenu·RoomList·Lobby·타이틀 바가 모두 이 매핑을 공유한다. */
export const GAME_LABELS: Record<GameId, string> = {
  blackjack: '블랙잭',
  onecard: '원카드',
  yacht: '야추',
  mafia: '마피아',
};

export const GAME_IDS: readonly GameId[] = ['blackjack', 'onecard', 'yacht', 'mafia'];

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
  vote: '투표',
};

/**
 * 게임 액션 이름 → 그 액션을 실제로 보내는 키. ActionBar는 예전에 `action.charAt(0)`으로
 * 힌트를 만들었는데, 이는 우연히 이름과 키가 같은 액션(hit→h, stand→s, draw→d 등)에서만
 * 맞고 그렇지 않은 액션(bet→Enter, ready→Enter, endGame→e, toggleHold→1~5, score→c,
 * play→Enter)에서는 화면이 실제로 반응하지 않는 키를 안내하는 결과를 냈다(리뷰 지적).
 * 여기 없는 액션은 ActionBar가 여전히 `action.charAt(0)`로 폴백한다.
 */
export const ACTION_KEYS: Record<string, string> = {
  // 로비/결과 공통
  start: 'Enter',
  replay: 'r',
  toLobby: 'q',
  // 블랙잭
  bet: 'Enter',
  hit: 'h',
  stand: 's',
  double: 'd',
  ready: 'Enter',
  endGame: 'e',
  // 야추
  toggleHold: '1-5',
  reroll: 'r',
  score: 'c',
  // 원카드
  play: 'Enter',
  draw: 'd',
  vote: 'Enter',
};

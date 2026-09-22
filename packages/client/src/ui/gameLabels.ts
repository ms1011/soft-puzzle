import type { GameId } from '@soft-puzzle/core';

/** 게임 id → 한국어 표시 이름. MainMenu·RoomList·Lobby·타이틀 바가 모두 이 매핑을 공유한다. */
export const GAME_LABELS: Record<GameId, string> = {
  blackjack: '블랙잭',
  onecard: '원카드',
  yacht: '야추',
  mafia: '마피아',
  davinci: '다빈치 코드',
  liar: '라이어 게임',
  indianPoker: '인디언 포커',
};

export const GAME_IDS: readonly GameId[] = ['blackjack', 'onecard', 'yacht', 'mafia', 'davinci', 'liar', 'indianPoker'];

export const GAME_INFO: Record<GameId, { minPlayers: number; summary: string; duration: string }> = {
  blackjack: { minPlayers: 2, summary: '21에 가깝게 카드를 모아 칩을 겨룹니다.', duration: '10~20분' },
  onecard: { minPlayers: 2, summary: '같은 숫자나 무늬를 내 손패를 먼저 비웁니다.', duration: '10~20분' },
  yacht: { minPlayers: 2, summary: '주사위 조합을 골라 가장 높은 점수를 만듭니다.', duration: '15~25분' },
  mafia: { minPlayers: 4, summary: '밤의 마피아를 찾아 투표로 탈락시킵니다.', duration: '10~20분' },
  davinci: { minPlayers: 2, summary: '숨겨진 숫자 타일을 추리해 최후까지 생존합니다.', duration: '10~15분' },
  liar: { minPlayers: 3, summary: '제시어를 모르는 라이어를 대화로 찾아냅니다.', duration: '5~10분' },
  indianPoker: { minPlayers: 2, summary: '상대 카드만 보고 콜 또는 폴드해 칩을 겨룹니다.', duration: '10~20분' },
};

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
  mafiaVote: '처치 대상 선택',
  protect: '보호 대상 선택',
  investigateMafia: '마피아 조사',
  investigateRole: '직업 조사',
  guess: '추리',
  call: '콜',
  fold: '폴드',
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
  mafiaVote: 'Enter',
  protect: 'Enter',
  investigateMafia: 'Enter',
  investigateRole: 'Enter',
  guess: 'Enter',
  call: 'Enter',
  fold: 'f',
};

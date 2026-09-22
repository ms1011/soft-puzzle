export type GameId = 'blackjack' | 'onecard' | 'yacht' | 'mafia' | 'davinci' | 'liar' | 'indianPoker';

/** 채팅이 전달된 범위 — 'all'은 방(또는 생존자) 전원, 나머지는 게임이 정한 비밀 채널이다. */
export type ChatChannel = 'all' | 'mafia' | 'dead';

export type ClientMsg =
  | { type: 'join'; nickname: string }
  | { type: 'action'; name: string; arg?: unknown }
  | { type: 'chat'; text: string }
  // 확정 전 커서. target의 모양은 게임마다 다르고 null은 "고민 중 아님"이다 — 서버가 엔진에 물어 검증·정리한다.
  | { type: 'focus'; target: unknown };

export interface GameView {
  phase: string;
  yourActions: string[];
  [k: string]: unknown;
}

export type ServerMsg =
  | { type: 'joined'; you: string }
  | {
      type: 'error';
      code: 'full' | 'dup' | 'playing' | 'bad-msg';
      message: string;
    }
  | {
      type: 'state';
      phase: 'lobby' | 'playing' | 'result';
      room: { name: string; game: GameId; host: string; players: string[] };
      /** playing일 때 현재 입력 단계가 자동 처리되는 절대 시각(ms). */
      deadline?: number;
      view?: GameView;
      result?: { ranking: { nickname: string; detail: string }[] };
    }
  | { type: 'event'; text: string }
  | { type: 'chat'; from: string; text: string; channel: ChatChannel }
  | { type: 'focus'; from: string; target: unknown };

export interface RoomInfo {
  room: string;
  game: GameId;
  players: string;
  addr: string;
}

export const DISCOVERY_PROBE = 'WHO_IS_THERE';
export const DEFAULT_TCP_PORT = 7420;
export const DEFAULT_UDP_PORT = 7421;
export const TURN_TIMEOUT_MS = 90_000;
export const MAX_PLAYERS = 6;
/** 서버가 trim 후 이 길이를 넘는 채팅을 잘라낸다. */
export const MAX_CHAT_LENGTH = 200;

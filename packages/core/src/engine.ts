import type { Rng } from './rng.js';
import type { ChatChannel, GameId, GameView } from './protocol.js';

export interface EngineEvent {
  text: string;
} // 딜러 멘트/알림 → event 메시지로 전달

export interface EngineAction {
  name: string;
  arg?: unknown;
}

/** 게임 진행 중 한 사람의 채팅을 누구에게 보낼지(또는 막을지)에 대한 엔진의 결정. */
export type ChatRoute =
  | { ok: true; channel: ChatChannel; to: string[] }
  | { ok: false; reason: string };

export interface GameEngine {
  readonly game: GameId;
  readonly minPlayers: number;
  start(players: string[], host: string, rng: Rng): void;
  setHost(host: string): void; // 세션 계층(Room)의 host 재할당을 엔진에 반영 — host 게이팅 액션이
  // 있는 엔진(블랙잭의 endGame)이 새 host를 인정하게 한다. host 개념이 없는 엔진은 no-op으로 구현한다.
  handleAction(player: string, action: EngineAction): EngineEvent[]; // 무효 액션이면 [] 반환, 상태 불변
  getViewFor(player: string): GameView;
  pendingPlayers(): string[]; // 지금 입력을 기다리는 플레이어들
  defaultAction(player: string): EngineAction | null; // 타임아웃 자동 처리용
  removePlayer(player: string): EngineEvent[]; // 이탈 처리
  isFinished(): boolean;
  result(): { ranking: { nickname: string; detail: string }[] } | null; // 종료 전엔 null
  // 선택: 게임 진행 중 채팅의 수신자를 엔진이 정한다(마피아의 밤 비밀 채팅 등). 없으면 Room이
  // 방 전원에게 'all'로 보낸다. 로비·결과 화면에서는 호출되지 않는다.
  chatRoute?(sender: string): ChatRoute;
}

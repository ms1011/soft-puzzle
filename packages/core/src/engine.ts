import type { Rng } from './rng.js';
import type { GameId, GameView } from './protocol.js';

export interface EngineEvent {
  text: string;
} // 딜러 멘트/알림 → event 메시지로 전달

export interface EngineAction {
  name: string;
  arg?: unknown;
}

export interface GameEngine {
  readonly game: GameId;
  readonly minPlayers: number;
  start(players: string[], host: string, rng: Rng): void;
  handleAction(player: string, action: EngineAction): EngineEvent[]; // 무효 액션이면 [] 반환, 상태 불변
  getViewFor(player: string): GameView;
  pendingPlayers(): string[]; // 지금 입력을 기다리는 플레이어들
  defaultAction(player: string): EngineAction | null; // 타임아웃 자동 처리용
  removePlayer(player: string): EngineEvent[]; // 이탈 처리
  isFinished(): boolean;
  result(): { ranking: { nickname: string; detail: string }[] } | null; // 종료 전엔 null
}

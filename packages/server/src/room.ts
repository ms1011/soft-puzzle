import {
  mulberry32,
  MAX_PLAYERS,
  TURN_TIMEOUT_MS,
  BlackjackEngine,
  YachtEngine,
  OneCardEngine,
} from '@card-night/core';
import type { Rng, GameId, ClientMsg, ServerMsg, RoomInfo, GameEngine, EngineEvent } from '@card-night/core';

export interface RoomOpts {
  name: string;
  game: GameId;
  host: string;
  /** 기본 mulberry32(Date.now()) */
  rng?: Rng;
  /** 기본 Date.now — 테스트에서 fake clock 주입 */
  now?: () => number;
}

type Phase = 'lobby' | 'playing' | 'result';

/** Room이 아는 유일한 game-id 분기점 — 새 엔진 인스턴스를 만드는 것 말고는 게임을 몰라야 한다. */
const ENGINE_FACTORIES: Record<GameId, () => GameEngine> = {
  blackjack: () => new BlackjackEngine(),
  onecard: () => new OneCardEngine(),
  yacht: () => new YachtEngine(),
};

/**
 * 하나의 게임 룸: 로비(입장/퇴장) → 플레이(엔진 위임 + 턴 타이머) → 결과(재시작/로비 복귀)의
 * 수명주기를 관리한다. 어떤 게임인지는 ENGINE_FACTORIES를 통해서만 알고, 그 밖의 모든 로직은
 * GameEngine 인터페이스만으로 동작한다.
 *
 * 네트워크는 전혀 모른다 — onSend로 등록된 콜백을 통해 (닉네임, 메시지) 쌍을 내보낼 뿐이고,
 * 타이머도 스스로 갖지 않는다(checkTimeout은 외부에서 주기적으로 호출해준다).
 */
export class Room {
  private readonly roomName: string;
  private readonly game: GameId;
  private host: string;
  private readonly rng: Rng;
  private readonly now: () => number;

  private players: string[] = [];
  private phase: Phase = 'lobby';
  private engine: GameEngine | undefined;
  private deadline: number | null = null;
  private sendCb: ((nickname: string, msg: ServerMsg) => void) | null = null;

  constructor(opts: RoomOpts) {
    this.roomName = opts.name;
    this.game = opts.game;
    this.host = opts.host;
    this.rng = opts.rng ?? mulberry32(Date.now());
    this.now = opts.now ?? Date.now;
  }

  onSend(cb: (nickname: string, msg: ServerMsg) => void): void {
    this.sendCb = cb;
  }

  join(nickname: string): { ok: true } | { ok: false; code: 'full' | 'dup' | 'playing' } {
    if (this.phase !== 'lobby') return { ok: false, code: 'playing' };
    if (this.players.includes(nickname)) return { ok: false, code: 'dup' };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, code: 'full' };

    this.players.push(nickname);
    if (!this.players.includes(this.host)) {
      // host가 더 이상 방에 없다(예: 방이 완전히 비었다가 다시 채워짐) — 새로 들어온 사람이
      // host가 되어야 방이 영영 시작 불가능한 상태로 좌초되지 않는다.
      this.host = nickname;
    }
    this.broadcastState();
    return { ok: true };
  }

  leave(nickname: string): void {
    if (!this.players.includes(nickname)) return;
    const wasHost = nickname === this.host;

    if (this.phase === 'playing' && this.engine) {
      const departureEvents = this.engine.removePlayer(nickname);
      this.players = this.players.filter((p) => p !== nickname);
      this.broadcastEvents(departureEvents);
      if (this.engine.isFinished()) {
        this.phase = 'result';
        this.deadline = null;
      } else {
        this.refreshDeadline();
      }
    } else {
      this.players = this.players.filter((p) => p !== nickname);
    }

    if (this.players.length === 0) {
      // 방이 완전히 비었다 — 알릴 사람은 없지만, 세션 상태를 로비로 리셋해두지 않으면 이 방은
      // 영원히 죽는다: phase가 'playing'/'result'에 멈춘 채면 info()는 "0/6"인데 join()은 계속
      // {code:'playing'}을 돌려주고, phase가 'lobby'였더라도 host가 떠난 사람 이름에 고정된 채라
      // 새로 들어온 사람은 절대 start할 수 없다(방장만 시작 가능이므로). host 자체는 join()에서
      // "방에 없는 host"를 감지해 새로 들어온 사람으로 넘겨준다.
      this.phase = 'lobby';
      this.engine = undefined;
      this.deadline = null;
      return;
    }

    if (wasHost) {
      // players는 join한 순서 그대로 유지되므로(제거만 하고 재정렬하지 않음), 맨 앞이
      // "가장 오래 남아있는" 플레이어다.
      this.host = this.players[0];
      // 게임이 실행 중(엔진이 존재)이면 엔진에도 새 host를 반영한다 — 그래야 블랙잭처럼
      // host 게이팅 액션(endGame)이 있는 엔진이 새 host를 인정한다. 방금 이 leave() 호출로
      // 막 끝난 엔진이라도 host 필드를 갱신하는 것 자체는 다른 어떤 상태(seats/order/턴 등)에도
      // 영향을 주지 않으므로 안전하다 — announce 전에 먼저 반영해 방송되는 state가 이미 참이 되게 한다.
      this.engine?.setHost(this.host);
      this.broadcastEvents([{ text: `${this.host}님이 새 방장이 되었습니다.` }]);
    }

    this.broadcastState();
  }

  handleMessage(nickname: string, msg: ClientMsg): void {
    if (!this.players.includes(nickname)) return; // 방에 없는 사람의 메시지는 무시
    if (msg === null || typeof msg !== 'object') return; // 네트워크 경계 — 형태를 신뢰하지 않는다

    const type = (msg as { type?: unknown }).type;
    if (type === 'action') {
      const name = (msg as { name?: unknown }).name;
      if (typeof name !== 'string') return;
      this.handleAction(nickname, name, (msg as { arg?: unknown }).arg);
    } else if (type === 'chat') {
      const text = (msg as { text?: unknown }).text;
      if (typeof text !== 'string') return;
      const trimmed = text.trim();
      if (!trimmed) return;
      this.broadcastEvents([{ text: `[${nickname}] ${trimmed}` }]);
    }
    // 'join'이나 알 수 없는 type은 여기서 다루지 않는다(join은 별도 API) — 조용히 무시.
  }

  checkTimeout(): void {
    if (this.phase !== 'playing' || !this.engine || this.deadline === null) return;
    if (this.now() < this.deadline) return;

    const pending = this.engine.pendingPlayers();
    const allEvents: EngineEvent[] = [];
    for (const p of pending) {
      const action = this.engine.defaultAction(p);
      if (action === null) continue;
      allEvents.push(...this.engine.handleAction(p, action));
    }
    allEvents.push({ text: '⏰ 시간 초과 — 자동 처리되었습니다' });
    this.broadcastEvents(allEvents);

    if (this.engine.isFinished()) {
      this.phase = 'result';
      this.deadline = null;
    } else {
      this.refreshDeadline();
    }
    this.broadcastState();
  }

  info(): RoomInfo {
    return {
      room: this.roomName,
      game: this.game,
      players: `${this.players.length}/${MAX_PLAYERS}`,
      addr: '',
    };
  }

  // ---- action 처리 ----

  private handleAction(nickname: string, name: string, arg: unknown): void {
    if (this.phase === 'lobby') {
      if (name === 'start') this.tryStart(nickname);
      return;
    }
    if (this.phase === 'playing') {
      this.handlePlayingAction(nickname, name, arg);
      return;
    }
    if (this.phase === 'result') {
      if (name === 'replay') this.tryReplay(nickname);
      else if (name === 'toLobby') this.tryToLobby(nickname);
      return;
    }
  }

  private tryStart(nickname: string): void {
    if (nickname !== this.host) {
      this.send(nickname, { type: 'event', text: '방장만 게임을 시작할 수 있습니다.' });
      return;
    }
    const engine = ENGINE_FACTORIES[this.game]();
    if (this.players.length < engine.minPlayers) {
      this.send(nickname, {
        type: 'event',
        text: `최소 ${engine.minPlayers}명이 있어야 시작할 수 있습니다.`,
      });
      return;
    }
    this.engine = engine;
    this.engine.start([...this.players], this.host, this.rng);
    this.phase = 'playing';
    this.refreshDeadline();
    this.broadcastState();
  }

  private handlePlayingAction(nickname: string, name: string, arg: unknown): void {
    if (!this.engine) return;
    // 엔진은 무효/자기 턴 아닌 액션에 대해 상태를 바꾸지 않고 []를 반환한다는 계약을 지킨다
    // (packages/core의 세 엔진 모두 문서화되어 있음) — 그래서 []는 "아무 일도 없었다"로 취급해
    // 안전하게 브로드캐스트를 건너뛸 수 있다.
    const evs = this.engine.handleAction(nickname, { name, arg });
    if (evs.length === 0) return;

    this.broadcastEvents(evs);
    if (this.engine.isFinished()) {
      this.phase = 'result';
      this.deadline = null;
    } else {
      this.refreshDeadline();
    }
    this.broadcastState();
  }

  private tryReplay(nickname: string): void {
    if (nickname !== this.host) {
      this.send(nickname, { type: 'event', text: '방장만 다시 시작할 수 있습니다.' });
      return;
    }
    const engine = ENGINE_FACTORIES[this.game]();
    this.engine = engine;
    this.engine.start([...this.players], this.host, this.rng);
    this.phase = 'playing';
    this.refreshDeadline();
    this.broadcastState();
  }

  private tryToLobby(nickname: string): void {
    if (nickname !== this.host) {
      this.send(nickname, { type: 'event', text: '방장만 로비로 돌아갈 수 있습니다.' });
      return;
    }
    this.engine = undefined;
    this.deadline = null;
    this.phase = 'lobby';
    this.broadcastState();
  }

  // ---- 브로드캐스트 ----

  private refreshDeadline(): void {
    this.deadline = this.now() + TURN_TIMEOUT_MS;
  }

  private send(nickname: string, msg: ServerMsg): void {
    this.sendCb?.(nickname, msg);
  }

  private broadcastEvents(evs: EngineEvent[]): void {
    for (const ev of evs) {
      for (const p of this.players) this.send(p, { type: 'event', text: ev.text });
    }
  }

  private broadcastState(): void {
    for (const p of this.players) this.send(p, this.stateFor(p));
  }

  private stateFor(nickname: string): ServerMsg {
    const room = { name: this.roomName, game: this.game, host: this.host, players: [...this.players] };
    if (this.phase === 'lobby' || !this.engine) {
      return { type: 'state', phase: 'lobby', room };
    }
    const view = this.engine.getViewFor(nickname);
    if (this.phase === 'result') {
      return { type: 'state', phase: 'result', room, view, result: this.engine.result() ?? undefined };
    }
    return { type: 'state', phase: 'playing', room, view };
  }
}

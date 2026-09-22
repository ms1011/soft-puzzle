import {
  mulberry32,
  MAX_PLAYERS,
  MAX_CHAT_LENGTH,
  TURN_TIMEOUT_MS,
  BlackjackEngine,
  YachtEngine,
  OneCardEngine,
  MafiaEngine,
  isValidMafiaCount,
  DavinciEngine,
  LiarEngine,
  IndianPokerEngine,
  YutEngine,
  LasVegasEngine,
} from '@soft-puzzle/core';
import type { Rng, GameId, ClientMsg, ServerMsg, RoomInfo, GameEngine, EngineEvent, MafiaSettings } from '@soft-puzzle/core';

export interface RoomOpts {
  name: string;
  game: GameId;
  host: string;
  /** 기본 mulberry32(Date.now()) */
  rng?: Rng;
  /** 기본 Date.now — 테스트에서 fake clock 주입 */
  now?: () => number;
  /** 마피아 방에서만 쓰는 역할·마피아 인원 설정. */
  mafiaSettings?: MafiaSettings;
}

export type Phase = 'lobby' | 'playing' | 'result';

/** Room이 아는 유일한 game-id 분기점 — 새 엔진 인스턴스를 만드는 것 말고는 게임을 몰라야 한다. */
const ENGINE_FACTORIES: Record<Exclude<GameId, 'mafia'>, () => GameEngine> = {
  blackjack: () => new BlackjackEngine(),
  onecard: () => new OneCardEngine(),
  yacht: () => new YachtEngine(),
  davinci: () => new DavinciEngine(),
  liar: () => new LiarEngine(),
  indianPoker: () => new IndianPokerEngine(),
  yut: () => new YutEngine(),
  lasVegas: () => new LasVegasEngine(),
};

const MAX_NICKNAME_LENGTH = 32;

/** 한 사람이 1초에 보낼 수 있는 focus 수. 넘치면 버린다 — 키를 꾹 누른 클라이언트나 악의적 폭주를 막는다. */
const FOCUS_LIMIT_PER_SECOND = 20;

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
  // null은 "host 자리가 진짜로 비어 있다"는 뜻이다(방이 완전히 비었을 때만) — 문자열 센티널('')은
  // 빈 닉네임이 실제로 join할 수 있는 한 실제 플레이어와 충돌할 수 있어 타입으로 배제한다.
  private host: string | null;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly mafiaSettings: MafiaSettings | undefined;

  private players: string[] = [];
  private phase: Phase = 'lobby';
  private engine: GameEngine | undefined;
  private deadline: number | null = null;
  private sendCb: ((nickname: string, msg: ServerMsg) => void) | null = null;
  /** 사람별 최근 focus 수신 시각 — 전송 빈도 제한용. */
  private focusTimes = new Map<string, number[]>();

  constructor(opts: RoomOpts) {
    this.roomName = opts.name;
    this.game = opts.game;
    this.host = opts.host;
    this.rng = opts.rng ?? mulberry32(Date.now());
    this.now = opts.now ?? Date.now;
    this.mafiaSettings = opts.mafiaSettings;
  }

  onSend(cb: (nickname: string, msg: ServerMsg) => void): void {
    this.sendCb = cb;
  }

  join(
    nickname: string,
  ): { ok: true } | { ok: false; code: 'full' | 'dup' | 'playing'; phase?: Phase } {
    // 닉네임도 네트워크에서 오는 값이므로 신뢰하지 않는다: 앞뒤 공백을 정리하고, 빈 문자열이나
    // 공백만으로 된 닉네임, 너무 긴 닉네임을 거부한다. 이건 단순히 표시 버그 방지 이상의 의미가
    // 있다 — 빈 문자열이 실제로 players에 들어갈 수 있다면 host 공석 판정에 쓰는 값과 실제
    // 플레이어 닉네임이 같은 타입(string)이라 서로 구분할 수 없게 된다(정확히 이전 라운드에서
    // 발견된 충돌). 적합한 기존 실패 코드가 없어 'dup'을 재사용한다 — "이 닉네임은 쓸 수 없다"는
    // 의미로 가장 가깝다.
    const nick = nickname.trim();
    if (nick.length === 0 || nick.length > MAX_NICKNAME_LENGTH) return { ok: false, code: 'dup' };
    // code는 여전히 'playing' 하나뿐이다(와이어 프로토콜의 error.code enum이 core에 고정돼
    // 있어 여기서 새 코드를 만들 수 없다) — 대신 실제 phase를 함께 실어 보내, toLobby가
    // 생긴 지금은 이 거절이 "result 화면(스코어보드)이 떠 있는 방"에서도 흔히 일어난다는
    // 걸 server.ts가 구분해 다른 문구를 고를 수 있게 한다. phase는 와이어로 직렬화되는
    // ServerMsg가 아니라 room.ts↔server.ts 사이의 내부 신호일 뿐이다.
    if (this.phase !== 'lobby') return { ok: false, code: 'playing', phase: this.phase };
    if (this.players.includes(nick)) return { ok: false, code: 'dup' };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, code: 'full' };

    this.players.push(nick);
    if (this.host === null) {
      // host 자리가 "진짜로 비어 있을 때"만(방이 완전히 비었다가 다시 채워지는 경우 등) 새로
      // 들어온 사람이 host가 된다. 지정된 host가 아직 한 번도 join하지 않은 상태(this.host는
      // opts.host로 채워져 있지만 players에는 없는 상태)와는 반드시 구분해야 한다 — 그 경우까지
      // "players에 없다"로 판단하면, 지정된 host보다 먼저 들어온 다른 사람이 영구히 host를
      // 가로채고 진짜 host는 join한 뒤에도 영영 시작 권한을 얻지 못한다(회귀 버그로 발견됨).
      // null은(문자열 센티널과 달리) 어떤 유효한 닉네임과도 절대 같을 수 없으므로, 위에서 빈
      // 닉네임을 거부하지 않았더라도 이 판정 자체는 여전히 안전하다.
      this.host = nick;
    }
    this.broadcastState();
    return { ok: true };
  }

  leave(nickname: string): void {
    const nick = nickname.trim();
    if (!this.players.includes(nick)) return;
    this.focusTimes.delete(nick);
    const wasHost = nick === this.host;

    if (this.phase === 'playing' && this.engine) {
      const departureEvents = this.engine.removePlayer(nick);
      this.players = this.players.filter((p) => p !== nick);
      this.broadcastEvents(departureEvents);
      if (this.engine.isFinished()) {
        this.phase = 'result';
        this.deadline = null;
      } else {
        this.refreshDeadline();
      }
    } else {
      this.players = this.players.filter((p) => p !== nick);
    }

    if (this.players.length === 0) {
      // 방이 완전히 비었다 — 알릴 사람은 없지만, 세션 상태를 로비로 리셋해두지 않으면 이 방은
      // 영원히 죽는다: phase가 'playing'/'result'에 멈춘 채면 info()는 "0/6"인데 join()은 계속
      // {code:'playing'}을 돌려주고, phase가 'lobby'였더라도 host가 떠난 사람 이름에 고정된 채라
      // 새로 들어온 사람은 절대 start할 수 없다(방장만 시작 가능이므로).
      //
      // host는 여기서 "누구였는지 잊고" 명시적으로 공석(null)으로 비워둔다 — join()이 이 공석을
      // 보고 다음 입장자를 host로 승격한다. players에 있는지 여부로 "host가 없다"를 추론하면
      // (이전 시도의 버그) 지정된 host가 아직 한 번도 join하지 않은 정상적인 상태와 구분할 수
      // 없어, 먼저 들어온 다른 사람이 영구히 host를 가로채는 회귀가 생긴다.
      this.phase = 'lobby';
      this.engine = undefined;
      this.deadline = null;
      this.host = null;
      return;
    }

    if (wasHost) {
      // players는 join한 순서 그대로 유지되므로(제거만 하고 재정렬하지 않음), 맨 앞이
      // "가장 오래 남아있는" 플레이어다.
      const newHost = this.players[0];
      this.host = newHost;
      // 게임이 실행 중(엔진이 존재)이면 엔진에도 새 host를 반영한다 — 그래야 블랙잭처럼
      // host 게이팅 액션(endGame)이 있는 엔진이 새 host를 인정한다. 방금 이 leave() 호출로
      // 막 끝난 엔진이라도 host 필드를 갱신하는 것 자체는 다른 어떤 상태(seats/order/턴 등)에도
      // 영향을 주지 않으므로 안전하다 — announce 전에 먼저 반영해 방송되는 state가 이미 참이 되게 한다.
      this.engine?.setHost(newHost);
      this.broadcastEvents([{ text: `${newHost}님이 새 방장이 되었습니다.` }]);
    }

    this.broadcastState();
  }

  handleMessage(nickname: string, msg: ClientMsg): void {
    const nick = nickname.trim();
    if (!this.players.includes(nick)) return; // 방에 없는 사람의 메시지는 무시
    if (msg === null || typeof msg !== 'object') return; // 네트워크 경계 — 형태를 신뢰하지 않는다

    const type = (msg as { type?: unknown }).type;
    if (type === 'action') {
      const name = (msg as { name?: unknown }).name;
      if (typeof name !== 'string') return;
      this.handleAction(nick, name, (msg as { arg?: unknown }).arg);
    } else if (type === 'chat') {
      const text = (msg as { text?: unknown }).text;
      if (typeof text !== 'string') return;
      const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!trimmed) return;
      this.handleChat(nick, trimmed);
    } else if (type === 'focus') {
      this.handleFocus(nick, (msg as { target?: unknown }).target ?? null);
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

  private createEngine(): GameEngine {
    if (this.game === 'mafia') return new MafiaEngine(this.mafiaSettings);
    return ENGINE_FACTORIES[this.game]();
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
    const engine = this.createEngine();
    if (this.players.length < engine.minPlayers) {
      this.send(nickname, {
        type: 'event',
        text: `최소 ${engine.minPlayers}명이 있어야 시작할 수 있습니다.`,
      });
      return;
    }
    if (this.game === 'mafia' && !isValidMafiaCount(this.players.length, this.mafiaSettings?.mafiaCount ?? Math.max(1, Math.floor(this.players.length / 3)))) {
      this.send(nickname, { type: 'event', text: `마피아는 현재 ${this.players.length}명의 절반 미만이어야 합니다.` });
      return;
    }
    this.engine = engine;
    // nickname === this.host는 위 guard에서 이미 확인됐다 — this.host(string | null)를 그대로
    // 넘기는 대신 이미 string으로 확정된 nickname을 넘기면 null 분기를 신경 쓸 필요가 없다.
    this.engine.start([...this.players], nickname, this.rng);
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
    const engine = this.createEngine();
    // tryStart와 동일한 guard(중요사항 4) — 없으면 게임 도중 이탈로 인원이 minPlayers 밑으로
    // 줄어든 채 result에 도착한 방에서, host의 반사적인 replay가 엔진의 명시된 계약(예:
    // 블랙잭 minPlayers=2)을 어기는 솔로 게임을 조용히 새로 시작해버린다.
    if (this.players.length < engine.minPlayers) {
      this.send(nickname, {
        type: 'event',
        text: `최소 ${engine.minPlayers}명이 있어야 시작할 수 있습니다.`,
      });
      return;
    }
    if (this.game === 'mafia' && !isValidMafiaCount(this.players.length, this.mafiaSettings?.mafiaCount ?? Math.max(1, Math.floor(this.players.length / 3)))) {
      this.send(nickname, { type: 'event', text: `마피아는 현재 ${this.players.length}명의 절반 미만이어야 합니다.` });
      return;
    }
    this.engine = engine;
    // nickname === this.host는 위 guard에서 이미 확인됐다 — 이유는 tryStart와 동일하다.
    this.engine.start([...this.players], nickname, this.rng);
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

  /**
   * 수신자는 게임 진행 중에만 엔진이 정한다(마피아의 밤 비밀 채팅·탈락자 격리 등) — 로비·결과
   * 화면이거나 chatRoute가 없는 엔진이면 방 전원이 받는다. 엔진이 돌려준 목록은 현재 방 참가자와
   * 교집합을 취해, 이미 나간 사람에게는 보내지 않는다.
   */
  private handleChat(nickname: string, text: string): void {
    const route = this.phase === 'playing' ? this.engine?.chatRoute?.(nickname) : undefined;
    if (route && !route.ok) {
      this.send(nickname, { type: 'event', text: route.reason });
      return;
    }
    const channel = route?.channel ?? 'all';
    const to = route ? this.players.filter((p) => route.to.includes(p)) : this.players;
    for (const p of to) this.send(p, { type: 'chat', from: nickname, text, channel });
  }

  /**
   * 차례인 사람의 확정 전 커서를 엔진이 정한 수신자에게 전달한다. 엔진 상태·deadline은 건드리지 않고
   * state도 새로 보내지 않는다. 받은 target이 아니라 엔진이 정리한 target만 보낸다.
   */
  private handleFocus(nickname: string, target: unknown): void {
    if (this.phase !== 'playing' || !this.engine?.focusRoute) return;
    if (!this.engine.pendingPlayers().includes(nickname)) return;
    if (!this.takeFocusSlot(nickname)) return;
    const route = this.engine.focusRoute(nickname, target);
    if (route === null) return;
    const recipients = route.to === 'all' ? this.players : this.players.filter((p) => route.to.includes(p));
    for (const p of recipients) {
      if (p !== nickname) this.send(p, { type: 'focus', from: nickname, target: route.target });
    }
  }

  /** 최근 1초 안의 focus 수가 한도 미만이면 한 칸을 쓰고 true. */
  private takeFocusSlot(nickname: string): boolean {
    const now = this.now();
    const recent = (this.focusTimes.get(nickname) ?? []).filter((t) => now - t < 1000);
    const allowed = recent.length < FOCUS_LIMIT_PER_SECOND;
    if (allowed) recent.push(now);
    this.focusTimes.set(nickname, recent);
    return allowed;
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
    // 불변식: this.host가 null인 것은 정확히 this.players가 빈 그 순간뿐이다(leave()가 방을
    // 비우는 바로 그 지점에서만 null로 만들고, join()은 players를 채우는 그 즉시 host를 다시
    // 채운다) — 그리고 broadcastState()는 항상 this.players를 순회해서 호출되므로, 이 함수가
    // 실행되고 있다는 사실 자체가 players가 비어있지 않다는 뜻이고 따라서 host도 null일 수
    // 없다. ServerMsg의 room.host는 string이라 타입을 맞추기 위해 ?? ''를 쓰지만, 실제로 이
    // 폴백이 관측되는 경로는 없다(도달 불가능한 방어적 코드).
    const room = { name: this.roomName, game: this.game, host: this.host ?? '', players: [...this.players] };
    if (this.phase === 'lobby' || !this.engine) {
      return { type: 'state', phase: 'lobby', room };
    }
    const view = this.engine.getViewFor(nickname);
    if (this.phase === 'result') {
      return { type: 'state', phase: 'result', room, view, result: this.engine.result() ?? undefined };
    }
    return { type: 'state', phase: 'playing', room, view, deadline: this.deadline ?? undefined };
  }
}

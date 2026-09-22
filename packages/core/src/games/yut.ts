import type { Rng } from '../rng.js';
import type { GameId, GameView } from '../protocol.js';
import type { GameEngine, EngineAction, EngineEvent } from '../engine.js';

/**
 * 윷판 칸 번호(총 29칸).
 *
 *  - 0..19: 바깥 둘레. 0 = 참먹이(출발·도착점), 반시계 방향으로 1, 2, … 19. 모서리는 5·10·15.
 *  - 20, 21: 모서리 5 → 방(가운데)으로 들어가는 지름길.
 *  - 22: 방(가운데).
 *  - 23, 24: 방 → 모서리 15로 나가는 지름길(5에서 들어온 말이 방을 "지나갈" 때의 길).
 *  - 25, 26: 모서리 10 → 방으로 들어가는 지름길.
 *  - 27, 28: 방 → 참먹이(0)로 나가는 지름길.
 *
 * 지름길 규칙(표준 윷판을 한 가지로 고정한 것):
 *  - 5에 "멈춘" 말은 다음 이동에서 5 → 20 → 21 → 22 → 23 → 24 → 15 → 16 … 19 → 나기.
 *  - 10에 "멈춘" 말은 다음 이동에서 10 → 25 → 26 → 22 → 27 → 28 → 나기.
 *  - 22(방)에 "멈춘" 말은 어느 길로 왔든 다음 이동에서 22 → 27 → 28 → 나기(가장 짧은 길).
 *  - 모서리를 멈추지 않고 지나가기만 한 말은 꺾지 않는다. 15에 멈춘 말은 그냥 둘레를 따라간다.
 */
export const YUT_STATION_COUNT = 29;
export const YUT_CENTER = 22;

/** 전진 한 칸의 결과로 "참먹이에 도달해 났다"를 뜻하는 내부 값. */
const FINISH = -1;

/** 이전 칸 기록(trail)이 없을 때 빽도가 쓰는 기본 뒤 칸. 참먹이(0)에서의 빽도는 19로 간다. */
const PRED: Record<number, number> = {
  0: 19,
  20: 5,
  21: 20,
  22: 21,
  23: 22,
  24: 23,
  25: 10,
  26: 25,
  27: 22,
  28: 27,
};
for (let i = 1; i <= 19; i++) PRED[i] = i - 1;

export type YutThrowName = '빽도' | '도' | '개' | '걸' | '윷' | '모';

const THROW_STEPS: Record<YutThrowName, number> = { 빽도: -1, 도: 1, 개: 2, 걸: 3, 윷: 4, 모: 5 };

/** 말 하나의 상태. trail은 판에 올라온 뒤 거쳐 온 칸들(마지막 원소 = 현재 칸) — 빽도가 "온 길로 한 칸
 * 되돌아가기"를 하려면 지나온 길을 알아야 한다(예: 방 22에서의 빽도는 21 또는 26으로). */
interface Piece {
  where: 'home' | 'board' | 'done';
  station: number;
  trail: number[];
}

export interface YutMove {
  throwIndex: number;
  piece: number;
  to: number | 'done';
  /** 이 이동으로 함께 움직이는 내 말 수(업힌 말 포함). */
  stack: number;
  /** 도착 칸에서 잡게 되는 상대 말 수. */
  capture: number;
}

/**
 * 윷가락 4개를 던진 결과. 각 가락은 p=0.5로 평평한 면(배)이 위로 온다. 0번 가락이 "빽도 표시" 가락이다.
 * 배가 0개 → 모, 1개 → 도(그 하나가 표시 가락이면 빽도), 2 → 개, 3 → 걸, 4 → 윷.
 */
export function throwSticks(rng: Rng): { name: YutThrowName; steps: number; sticks: boolean[] } {
  const sticks = [0, 1, 2, 3].map(() => rng() < 0.5);
  const flats = sticks.filter(Boolean).length;
  let name: YutThrowName;
  if (flats === 0) name = '모';
  else if (flats === 1) name = sticks[0] ? '빽도' : '도';
  else if (flats === 2) name = '개';
  else if (flats === 3) name = '걸';
  else name = '윷';
  return { name, steps: THROW_STEPS[name], sticks };
}

/** 한 칸 전진. first는 "이번 이동의 첫 걸음"인지 — 멈춰 있던 모서리/방에서만 꺾는다. */
function stepForward(from: number, prev: number | undefined, first: boolean): number {
  if (first) {
    if (from === 5) return 20;
    if (from === 10) return 25;
    if (from === YUT_CENTER) return 27;
  }
  if (from >= 0 && from <= 18) return from + 1;
  switch (from) {
    case 19:
      return FINISH;
    case 20:
      return 21;
    case 21:
      return YUT_CENTER;
    case YUT_CENTER:
      // 방을 멈추지 않고 지나가는 경우 — 들어온 방향 그대로 직진한다.
      return prev === 26 ? 27 : 23;
    case 23:
      return 24;
    case 24:
      return 15;
    case 25:
      return 26;
    case 26:
      return YUT_CENTER;
    case 27:
      return 28;
    case 28:
      return FINISH;
    default:
      return FINISH;
  }
}

/**
 * 말(또는 아직 판에 없는 말)을 steps만큼 움직였을 때의 도착 칸과 새 trail. 순수 함수.
 * 판에 없는 말은 참먹이(0)에서 출발한다. 빽도(-1)는 판 위의 말에만 쓸 수 있다(null 반환).
 * 참먹이(0)에 "도달"하면 그 즉시 나기(done) — 남은 걸음은 버린다(단순화).
 */
function computeMove(piece: Piece, steps: number): { to: number | 'done'; trail: number[] } | null {
  if (piece.where === 'done') return null;
  if (steps < 0) {
    if (piece.where !== 'board') return null;
    const trail = [...piece.trail];
    if (trail.length >= 2) {
      trail.pop();
      return { to: trail[trail.length - 1]!, trail };
    }
    const to = PRED[piece.station]!;
    return { to, trail: [to] };
  }
  const trail = piece.where === 'home' ? [0] : [...piece.trail];
  let cur = piece.where === 'home' ? 0 : piece.station;
  for (let i = 0; i < steps; i++) {
    const next = stepForward(cur, trail[trail.length - 2], i === 0);
    if (next === FINISH) return { to: 'done', trail: [] };
    trail.push(next);
    cur = next;
  }
  return { to: cur, trail };
}

/** 칸 station에 멈춰 있는 말이 나기까지 필요한 최소 걸음 수(순위 동점 판정용 진행도 계산). */
function remainingSteps(station: number): number {
  const probe: Piece = { where: 'board', station, trail: [station] };
  for (let k = 1; k <= 30; k++) {
    if (computeMove(probe, k)?.to === 'done') return k;
  }
  return 30;
}

/** 한글 받침 유무에 따른 조사 선택. */
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}
function iGa(word: string): string {
  return hasBatchim(word) ? '이' : '가';
}
function euro(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  // 받침이 없거나 ㄹ 받침(8)이면 '로', 그 외 받침이면 '으로'.
  return hasBatchim(word) && code % 28 !== 8 ? '으로' : '로';
}

const PIECES_PER_PLAYER = 4;
const MARKERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * 윷놀이 엔진(개인전, 2~6인, 1인당 말 4개).
 *
 * 턴 모델 — "던질 기회(credits)"와 "쌓인 결과(pending)" 두 가지로 표현한다:
 *  - 턴 시작 시 credits=1, pending=[].
 *  - credits>0이면 phase='throw': throw 한 번에 credits를 1 쓰고 결과를 pending 끝에 쌓는다.
 *    윷·모가 나오면 credits+1(한 번 더).
 *  - credits=0이면 phase='move': move({throwIndex, piece})로 pending 중 하나를 골라 쓴다.
 *    상대 말을 잡으면 credits+1 — 즉시 phase='throw'로 돌아가 한 번 더 던지고, 아직 안 쓴
 *    pending 결과는 그대로 남아 그 뒤에 함께 쓴다.
 *  - move 단계에 들어설 때마다 "남은 결과 중 쓸 수 있는 게 하나도 없으면"(예: 판에 말이 없는데
 *    빽도만 남음) 남은 결과를 모두 버린다. 하나라도 쓸 수 있으면 버리지 않는다 — 도를 먼저 써서
 *    말을 올리면 빽도도 쓸 수 있게 되기 때문이다.
 *  - credits=0이고 pending이 비면 다음 사람 차례.
 *
 * 불변식: !finished인 동안 0 <= turnIdx < order.length이고, phase='move'라면 현재 플레이어에게
 * 합법 수가 최소 하나 있다(settle()이 보장) — 그래서 defaultAction은 대기 중인 사람에게 항상
 * 합법 액션을 돌려준다.
 */
export class YutEngine implements GameEngine {
  readonly game: GameId = 'yut';
  readonly minPlayers = 2;

  private rng!: Rng;
  private order: string[] = [];
  private markers = new Map<string, string>();
  private pieces = new Map<string, Piece[]>();
  private turnIdx = 0;
  private credits = 0;
  private pending: { name: YutThrowName; steps: number }[] = [];
  private lastThrow: { player: string; name: YutThrowName; steps: number; sticks: boolean[] } | null = null;
  private finished = false;
  private winner: string | null = null;

  start(players: string[], _host: string, rng: Rng): void {
    this.rng = rng;
    this.order = [...players];
    // 표시 기호(A~F)는 시작 순서로 고정한다 — 누가 나가도 남은 사람의 기호가 바뀌지 않게.
    this.markers = new Map(players.map((p, i) => [p, MARKERS[i] ?? String(i + 1)]));
    this.pieces = new Map(
      players.map((p) => [
        p,
        Array.from({ length: PIECES_PER_PLAYER }, (): Piece => ({ where: 'home', station: 0, trail: [] })),
      ]),
    );
    this.turnIdx = 0;
    this.lastThrow = null;
    this.finished = false;
    this.winner = null;
    this.beginTurn();
  }

  // 윷놀이에는 host 게이팅 액션이 없다 — no-op.
  setHost(_host: string): void {}

  private beginTurn(): void {
    this.credits = 1;
    this.pending = [];
  }

  private current(): string {
    return this.order[this.turnIdx]!;
  }

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.finished) return [];
    if (this.current() !== player) return [];
    if (action.name === 'throw') return this.doThrow(player);
    if (action.name === 'move') return this.doMove(player, action.arg);
    return [];
  }

  private doThrow(player: string): EngineEvent[] {
    if (this.credits <= 0) return [];
    const t = throwSticks(this.rng);
    this.credits--;
    this.pending.push({ name: t.name, steps: t.steps });
    this.lastThrow = { player, ...t };
    const events: EngineEvent[] = [{ text: `${player}님이 윷을 던져 [${t.name}]${iGa(t.name)} 나왔습니다.` }];
    if (t.name === '윷' || t.name === '모') {
      this.credits++;
      events.push({ text: `[${t.name}]! 한 번 더 던집니다.` });
    }
    this.settle(events);
    return events;
  }

  private doMove(player: string, arg: unknown): EngineEvent[] {
    if (this.credits > 0) return [];
    if (typeof arg !== 'object' || arg === null) return [];
    const { throwIndex, piece } = arg as Record<string, unknown>;
    if (typeof throwIndex !== 'number' || !Number.isInteger(throwIndex)) return [];
    if (typeof piece !== 'number' || !Number.isInteger(piece)) return [];
    if (throwIndex < 0 || throwIndex >= this.pending.length) return [];
    const mine = this.pieces.get(player)!;
    if (piece < 0 || piece >= mine.length) return [];
    const moving = mine[piece]!;
    const t = this.pending[throwIndex]!;
    const res = computeMove(moving, t.steps);
    if (!res) return [];

    // 같은 칸의 내 말(업힌 말)은 함께 움직인다. 판에 없던 말은 혼자 들어온다.
    const group =
      moving.where === 'board'
        ? mine.filter((m) => m.where === 'board' && m.station === moving.station)
        : [moving];
    this.pending.splice(throwIndex, 1);
    const events: EngineEvent[] = [];
    const who = group.length > 1 ? `업힌 말 ${group.length}개를` : '말을';

    if (res.to === 'done') {
      for (const m of group) {
        m.where = 'done';
        m.trail = [];
      }
      events.push({ text: `${player}님이 [${t.name}]${euro(t.name)} ${who} 내보냈습니다(나기).` });
      const doneCount = mine.filter((m) => m.where === 'done').length;
      if (doneCount === PIECES_PER_PLAYER) {
        this.finished = true;
        this.winner = player;
        events.push({ text: `${player}님이 말 4개를 모두 났습니다. 승리!` });
        return events;
      }
    } else {
      const to = res.to;
      for (const m of group) {
        m.where = 'board';
        m.station = to;
        m.trail = [...res.trail];
      }
      events.push({ text: `${player}님이 [${t.name}]${euro(t.name)} ${who} 옮겼습니다.` });

      // 도착 칸에 원래 있던 내 말과 업는다 — 이후 한 덩어리로 움직이도록 trail도 맞춘다.
      const stacked = mine.filter((m) => m.where === 'board' && m.station === to);
      if (stacked.length > group.length) {
        for (const m of stacked) m.trail = [...res.trail];
        events.push({ text: `말을 업었습니다! (${stacked.length}개)` });
      }

      // 도착 칸의 상대 말은 모두 잡혀 집으로 돌아간다.
      let captured = 0;
      const victims: string[] = [];
      for (const other of this.order) {
        if (other === player) continue;
        let n = 0;
        for (const m of this.pieces.get(other)!) {
          if (m.where === 'board' && m.station === to) {
            m.where = 'home';
            m.station = 0;
            m.trail = [];
            n++;
          }
        }
        if (n > 0) {
          captured += n;
          victims.push(`${other}님의 말 ${n}개`);
        }
      }
      if (captured > 0) {
        this.credits++;
        events.push({ text: `${victims.join(', ')}를 잡았습니다! 한 번 더 던집니다.` });
      }
    }

    this.settle(events);
    return events;
  }

  /** 이번 행동 뒤의 단계를 정리한다: 쓸 수 없는 결과 버리기, 턴 넘기기. */
  private settle(events: EngineEvent[]): void {
    if (this.finished) return;
    if (this.credits > 0) return; // 아직 던질 차례
    if (this.pending.length > 0 && this.legalMoves(this.current()).length === 0) {
      const names = this.pending.map((t) => `[${t.name}]`).join(' ');
      events.push({ text: `움직일 수 있는 말이 없어 남은 윷(${names})을 버립니다.` });
      this.pending = [];
    }
    if (this.pending.length === 0) {
      this.turnIdx = (this.turnIdx + 1) % this.order.length;
      this.beginTurn();
      events.push({ text: `${this.current()}님의 차례입니다.` });
    }
  }

  /**
   * player가 지금 둘 수 있는 수 목록. 같은 결과로 똑같이 움직이는 말은 대표 하나(가장 작은 번호)만
   * 싣는다 — 집에 있는 말들은 모두 같고, 업힌 말은 어느 것을 골라도 덩어리 전체가 움직이기 때문이다.
   * (엔진은 대표가 아닌 번호로 온 move도 똑같이 받아준다.)
   */
  private legalMoves(player: string): YutMove[] {
    if (this.finished || this.current() !== player || this.credits > 0) return [];
    const mine = this.pieces.get(player)!;
    const moves: YutMove[] = [];
    this.pending.forEach((t, throwIndex) => {
      const seen = new Set<string>();
      mine.forEach((m, piece) => {
        const key = m.where === 'board' ? `b${m.station}` : m.where;
        if (m.where === 'done' || seen.has(key)) return;
        const res = computeMove(m, t.steps);
        if (!res) return;
        seen.add(key);
        const stack = m.where === 'board' ? mine.filter((o) => o.where === 'board' && o.station === m.station).length : 1;
        let capture = 0;
        if (res.to !== 'done') {
          for (const other of this.order) {
            if (other === player) continue;
            capture += this.pieces.get(other)!.filter((o) => o.where === 'board' && o.station === res.to).length;
          }
        }
        moves.push({ throwIndex, piece, to: res.to, stack, capture });
      });
    });
    return moves;
  }

  getViewFor(player: string): GameView {
    const turnPlayer = this.finished ? null : this.current();
    const players = this.order.map((p) => {
      const mine = this.pieces.get(p)!;
      return {
        nickname: p,
        marker: this.markers.get(p)!,
        pieces: mine.map((m) =>
          m.where === 'board' ? { state: 'board' as const, station: m.station } : { state: m.where },
        ),
        finished: mine.filter((m) => m.where === 'done').length,
        home: mine.filter((m) => m.where === 'home').length,
        isTurn: p === turnPlayer,
      };
    });
    return {
      phase: this.credits > 0 ? 'throw' : 'move',
      yourActions: this.yourActions(player),
      turnPlayer,
      throws: this.pending.map((t) => ({ ...t })),
      throwsLeft: this.finished ? 0 : this.credits,
      players,
      lastThrow: this.lastThrow ? { ...this.lastThrow, sticks: [...this.lastThrow.sticks] } : null,
      moves: this.legalMoves(player),
    };
  }

  private yourActions(player: string): string[] {
    if (this.finished || this.current() !== player) return [];
    return this.credits > 0 ? ['throw'] : ['move'];
  }

  pendingPlayers(): string[] {
    if (this.finished) return [];
    return [this.current()];
  }

  // 순수 조회 — 상태를 바꾸지 않는다. 우선순위: 잡기 > 판 위에서 가장 앞선 말 > 새 말.
  defaultAction(player: string): EngineAction | null {
    if (this.finished || this.current() !== player) return null;
    if (this.credits > 0) return { name: 'throw' };
    const moves = this.legalMoves(player);
    if (moves.length === 0) return null; // settle() 불변식상 도달 불가 — 방어적 처리
    const first = moves[0]!.throwIndex;
    const candidates = moves.filter((m) => m.throwIndex === first);
    const mine = this.pieces.get(player)!;
    const pick =
      candidates.find((m) => m.capture > 0) ??
      candidates
        .filter((m) => mine[m.piece]!.where === 'board')
        .sort((a, b) => remainingSteps(mine[a.piece]!.station) - remainingSteps(mine[b.piece]!.station))[0] ??
      candidates[0]!;
    return { name: 'move', arg: { throwIndex: pick.throwIndex, piece: pick.piece } };
  }

  removePlayer(player: string): EngineEvent[] {
    const idx = this.order.indexOf(player);
    if (idx === -1 || this.finished) return [];

    const wasCurrentTurn = idx === this.turnIdx;
    this.order.splice(idx, 1);
    this.pieces.delete(player); // 떠난 사람의 말은 판에서 사라진다
    if (idx < this.turnIdx) this.turnIdx--;
    const events: EngineEvent[] = [{ text: `${player}님이 게임을 떠났습니다.` }];

    if (this.order.length < 2) {
      this.finished = true;
      this.winner = this.order[0] ?? null;
      if (this.winner) events.push({ text: `${this.winner}님이 승리했습니다.` });
      return events;
    }
    this.turnIdx = this.turnIdx % this.order.length;
    if (wasCurrentTurn) {
      this.beginTurn();
      events.push({ text: `${this.current()}님의 차례입니다.` });
    }
    return events;
  }

  isFinished(): boolean {
    return this.finished;
  }

  result(): { ranking: { nickname: string; detail: string }[] } | null {
    if (!this.finished) return null;
    const scored = this.order.map((p) => {
      const mine = this.pieces.get(p)!;
      const done = mine.filter((m) => m.where === 'done').length;
      const progress = mine.reduce((s, m) => s + (m.where === 'board' ? 30 - remainingSteps(m.station) : 0), 0);
      return { nickname: p, done, progress, win: p === this.winner ? 1 : 0 };
    });
    scored.sort((a, b) => b.win - a.win || b.done - a.done || b.progress - a.progress);
    return { ranking: scored.map((s) => ({ nickname: s.nickname, detail: `${s.done}개 완주` })) };
  }
}

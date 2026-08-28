import type { Rng } from '../rng.js';
import type { GameId, GameView } from '../protocol.js';
import type { GameEngine, EngineAction, EngineEvent } from '../engine.js';

export type YachtCategory =
  | 'ones'
  | 'twos'
  | 'threes'
  | 'fours'
  | 'fives'
  | 'sixes'
  | 'threeKind'
  | 'fourKind'
  | 'fullHouse'
  | 'smallStraight'
  | 'largeStraight'
  | 'yacht'
  | 'chance';

const UPPER_FACE: Record<'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes', number> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
};

const UPPER_CATEGORIES = Object.keys(UPPER_FACE) as (keyof typeof UPPER_FACE)[];

/** 게임에서 turn마다 순회할 전체 13칸의 고정 순서. */
const ALL_CATEGORIES: YachtCategory[] = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
  'chance',
];

const CATEGORY_LABELS: Record<YachtCategory, string> = {
  ones: '1',
  twos: '2',
  threes: '3',
  fours: '4',
  fives: '5',
  sixes: '6',
  threeKind: '트리플',
  fourKind: '포카드',
  fullHouse: '풀하우스',
  smallStraight: '스몰 스트레이트',
  largeStraight: '라지 스트레이트',
  yacht: '야추',
  chance: '찬스',
};

const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS = 35;

function sum(dice: number[]): number {
  return dice.reduce((a, b) => a + b, 0);
}

function counts(dice: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of dice) m.set(d, (m.get(d) ?? 0) + 1);
  return m;
}

function uniqueSorted(dice: number[]): number[] {
  return [...new Set(dice)].sort((a, b) => a - b);
}

/**
 * 주사위 5개(dice)와 카테고리(cat)를 받아 해당 칸의 점수를 계산하는 순수 함수.
 * 엔진 상태와 무관하게 어디서든(테스트, UI 미리보기, defaultAction) 재사용된다.
 */
export function scoreCategory(dice: number[], cat: YachtCategory): number {
  if (cat in UPPER_FACE) {
    const face = UPPER_FACE[cat as keyof typeof UPPER_FACE];
    return dice.filter((d) => d === face).length * face;
  }
  const c = counts(dice);
  const maxCount = Math.max(...c.values());

  switch (cat) {
    case 'threeKind':
      return maxCount >= 3 ? sum(dice) : 0;
    case 'fourKind':
      return maxCount >= 4 ? sum(dice) : 0;
    case 'fullHouse': {
      const values = [...c.values()].sort((a, b) => a - b);
      const isFiveKind = values.length === 1 && values[0] === 5;
      const isThreePlusTwo = values.length === 2 && values.includes(2) && values.includes(3);
      return isFiveKind || isThreePlusTwo ? 25 : 0;
    }
    case 'smallStraight': {
      const s = new Set(dice);
      const windows = [
        [1, 2, 3, 4],
        [2, 3, 4, 5],
        [3, 4, 5, 6],
      ];
      return windows.some((w) => w.every((v) => s.has(v))) ? 30 : 0;
    }
    case 'largeStraight': {
      const u = uniqueSorted(dice);
      return u.length === 5 && u[4] - u[0] === 4 ? 40 : 0;
    }
    case 'yacht':
      return maxCount === 5 ? 50 : 0;
    case 'chance':
      return sum(dice);
    default:
      return 0;
  }
}

type Sheet = Partial<Record<YachtCategory, number>>;

function hasScored(sheet: Sheet, cat: YachtCategory): boolean {
  return Object.prototype.hasOwnProperty.call(sheet, cat);
}

function summarize(sheet: Sheet): { upperTotal: number; bonus: number; total: number } {
  let upperTotal = 0;
  for (const c of UPPER_CATEGORIES) {
    if (hasScored(sheet, c)) upperTotal += sheet[c]!;
  }
  const bonus = upperTotal >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
  let total = bonus;
  for (const v of Object.values(sheet)) total += v as number;
  return { upperTotal, bonus, total };
}

/**
 * 야추(Yacht) 엔진.
 *
 * 내부 상태:
 *  - order: 참가자 순서(이탈 시 축소됨)
 *  - turnIdx: order 안에서 현재 턴인 인덱스 — !finished인 동안 항상 0 <= turnIdx < order.length를
 *    유지한다. 이 불변식 덕분에 pendingPlayers()는 !finished인 한 절대 빈 배열을 반환하지 않는다
 *    (order가 비면 그 즉시 finished를 true로 만들기 때문 — removePlayer 참고).
 *  - dice/held/rollsLeft: 현재 턴 진행 중인 플레이어(order[turnIdx])의 주사위 상태. 턴마다
 *    beginTurn()에서 새로 굴리고 리셋된다.
 *  - sheets: 플레이어별 점수표(13칸 중 아직 채우지 않은 칸은 키 자체가 없음 — 0점과 구분하기 위해
 *    값을 undefined로 두지 않고 키 존재 여부로 판단한다).
 *
 * 턴 진행: score()가 호출되면 그 즉시(같은 handleAction 호출 안에서) "전원 13칸 완료"를 확인해
 * finished를 확정하거나, 다음 사람 턴을 beginTurn()으로 시작한다 — 그 사이에 관측 가능한
 * "아무도 대기 중이 아닌데 안 끝난" 상태가 없다.
 */
export class YachtEngine implements GameEngine {
  readonly game: GameId = 'yacht';
  readonly minPlayers = 1;

  private rng!: Rng;
  private order: string[] = [];
  private turnIdx = 0;
  private dice: number[] = [1, 1, 1, 1, 1];
  private held: boolean[] = [false, false, false, false, false];
  private rollsLeft = 0;
  private sheets = new Map<string, Sheet>();
  private finished = false;

  start(players: string[], _host: string, rng: Rng): void {
    this.rng = rng;
    this.order = [...players];
    this.turnIdx = 0;
    this.sheets = new Map(players.map((p) => [p, {}]));
    this.finished = false;
    this.beginTurn();
  }

  // 야추에는 host 게이팅 액션이 없다(start()의 host 인자도 무시한다) — no-op.
  setHost(_host: string): void {}

  private rollDie(): number {
    return Math.floor(this.rng() * 6) + 1;
  }

  private beginTurn(): void {
    this.dice = [0, 0, 0, 0, 0].map(() => this.rollDie());
    this.held = [false, false, false, false, false];
    this.rollsLeft = 2;
  }

  private allFilled(): boolean {
    return this.order.length > 0 && this.order.every((p) => this.isSheetFull(p));
  }

  private isSheetFull(p: string): boolean {
    const sheet = this.sheets.get(p);
    return !!sheet && Object.keys(sheet).length === ALL_CATEGORIES.length;
  }

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.finished) return [];
    if (this.order[this.turnIdx] !== player) return [];

    if (action.name === 'toggleHold') return this.doToggleHold(player, action.arg);
    if (action.name === 'reroll') return this.doReroll(player);
    if (action.name === 'score') return this.doScore(player, action.arg);
    return [];
  }

  private doToggleHold(player: string, arg: unknown): EngineEvent[] {
    if (typeof arg !== 'number' || !Number.isInteger(arg) || arg < 0 || arg > 4) return [];
    this.held[arg] = !this.held[arg];
    const state = this.held[arg] ? '홀드' : '홀드 해제';
    return [{ text: `${player}님이 주사위 ${arg + 1}번을 ${state}했습니다.` }];
  }

  private doReroll(player: string): EngineEvent[] {
    if (this.rollsLeft <= 0) return [];
    for (let i = 0; i < 5; i++) {
      if (!this.held[i]) this.dice[i] = this.rollDie();
    }
    this.rollsLeft--;
    return [{ text: `${player}님이 주사위를 다시 굴렸습니다. (남은 굴림 ${this.rollsLeft}회)` }];
  }

  private doScore(player: string, arg: unknown): EngineEvent[] {
    if (typeof arg !== 'string' || !ALL_CATEGORIES.includes(arg as YachtCategory)) return [];
    const cat = arg as YachtCategory;
    const sheet = this.sheets.get(player)!;
    if (hasScored(sheet, cat)) return [];

    const points = scoreCategory(this.dice, cat);
    sheet[cat] = points;
    const events: EngineEvent[] = [
      { text: `${player}님이 [${CATEGORY_LABELS[cat]}] 칸에 ${points}점을 기록했습니다.` },
    ];

    if (this.allFilled()) {
      this.finished = true;
      events.push({ text: '게임 종료! 최종 결과를 확인하세요.' });
      return events;
    }

    this.turnIdx = (this.turnIdx + 1) % this.order.length;
    this.beginTurn();
    events.push({ text: `${this.order[this.turnIdx]}님의 차례입니다.` });
    return events;
  }

  getViewFor(player: string): GameView {
    const turnPlayer = this.finished ? null : this.order[this.turnIdx];
    const players = this.order.map((p) => {
      const sheet = this.sheets.get(p) ?? {};
      const { upperTotal, bonus, total } = summarize(sheet);
      return {
        nickname: p,
        sheet: { ...sheet },
        upperTotal,
        bonus,
        total,
        isTurn: p === turnPlayer,
      };
    });

    return {
      phase: 'turn',
      yourActions: this.yourActions(player),
      turnPlayer,
      dice: [...this.dice],
      held: [...this.held],
      rollsLeft: this.rollsLeft,
      players,
    };
  }

  private yourActions(player: string): string[] {
    if (this.finished) return [];
    if (this.order[this.turnIdx] !== player) return [];
    const actions: string[] = [];
    if (this.rollsLeft > 0) actions.push('reroll');
    actions.push('toggleHold', 'score');
    return actions;
  }

  pendingPlayers(): string[] {
    if (this.finished) return [];
    return [this.order[this.turnIdx]];
  }

  // 순수 조회 메서드다 — 상태를 절대 변경하지 않는다 (Room이 타이머 렌더링을 위해
  // 몇 번을 호출하든, 실제 자동 처리 전에 미리 호출하든 안전해야 한다).
  defaultAction(player: string): EngineAction | null {
    if (this.finished) return null;
    if (this.order[this.turnIdx] !== player) return null;
    const sheet = this.sheets.get(player)!;
    if (!hasScored(sheet, 'chance')) return { name: 'score', arg: 'chance' };

    let best: YachtCategory | null = null;
    let bestScore = -1;
    for (const cat of ALL_CATEGORIES) {
      if (hasScored(sheet, cat)) continue;
      const s = scoreCategory(this.dice, cat);
      if (s > bestScore) {
        bestScore = s;
        best = cat;
      }
    }
    // player가 pendingPlayers()에 있다는 것 자체가 아직 13칸을 다 못 채웠다는 뜻이므로
    // best는 반드시 존재한다. null은 이론상 도달 불가능한 방어적 처리다.
    return best ? { name: 'score', arg: best } : null;
  }

  removePlayer(player: string): EngineEvent[] {
    const idx = this.order.indexOf(player);
    if (idx === -1) return [];

    const wasCurrentTurn = !this.finished && idx === this.turnIdx;
    this.order.splice(idx, 1);
    this.sheets.delete(player);
    if (idx < this.turnIdx) this.turnIdx--;

    const events: EngineEvent[] = [{ text: `${player}님이 게임을 떠났습니다.` }];

    if (this.order.length === 0) {
      this.finished = true;
      return events;
    }
    if (this.finished) return events; // 이미 종료된 게임 — result()가 매번 남은 order로 다시 계산한다.

    this.turnIdx = this.turnIdx % this.order.length;
    if (this.allFilled()) {
      this.finished = true;
    } else if (wasCurrentTurn) {
      // 지금 턴이던 사람이 떠났으니, 다음 자리에 온 사람의 턴을 새로 시작한다.
      this.beginTurn();
    }
    return events;
  }

  isFinished(): boolean {
    return this.finished;
  }

  result(): { ranking: { nickname: string; detail: string }[] } | null {
    if (!this.finished) return null;
    const ranking = this.order
      .map((p) => ({ nickname: p, total: summarize(this.sheets.get(p) ?? {}).total }))
      .sort((a, b) => b.total - a.total)
      .map((r) => ({ nickname: r.nickname, detail: `${r.total}점` }));
    return { ranking };
  }
}

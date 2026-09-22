import { shuffle, type Rng } from '../rng.js';
import type { GameId, GameView } from '../protocol.js';
import type { GameEngine, EngineAction, EngineEvent } from '../engine.js';

/** 카지노는 주사위 눈 1~6에 하나씩 대응한다. */
export const CASINO_COUNT = 6;
export const TOTAL_ROUNDS = 4;
export const DICE_PER_PLAYER = 8;
/** 라운드마다 카지노 하나에 깔리는 지폐 합계의 최소치(단위: 천 달러 → 50 = $50,000). */
export const CASINO_MIN_TOTAL = 50;

/**
 * 지폐 덱 구성(단위: 천 달러). 원작과 같은 54장: 10k×6, 20k×8, 30k×8, 40k×6, 50k×6,
 * 60k×5, 70k×5, 80k×5, 90k×5.
 */
const BILL_COUNTS: ReadonlyArray<readonly [number, number]> = [
  [10, 6],
  [20, 8],
  [30, 8],
  [40, 6],
  [50, 6],
  [60, 5],
  [70, 5],
  [80, 5],
  [90, 5],
];

export function makeMoneyDeck(): number[] {
  const deck: number[] = [];
  for (const [value, n] of BILL_COUNTS) for (let i = 0; i < n; i++) deck.push(value);
  return deck;
}

/** 천 달러 단위 금액을 `$60,000` 형태로 적는다(로케일에 의존하지 않도록 직접 구분자를 넣는다). */
export function formatMoney(thousands: number): string {
  const digits = String(Math.round(thousands * 1000));
  return '$' + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 카지노 한 곳의 정산 — 순수 함수. bills는 내림차순 정렬된 지폐, counts는 그 카지노에 놓인
 * 플레이어별 주사위 개수다. 같은 개수를 가진 사람이 둘 이상이면 그 개수의 사람들은 전원
 * 무효(아무것도 못 받음)가 되고, 남은 사람을 개수 내림차순으로 세워 높은 지폐부터 한 장씩 준다.
 * 사람보다 지폐가 적으면 뒤쪽은 못 받고, 남은 지폐는 버려진다(반환값에 없다).
 */
export function payout(
  bills: readonly number[],
  counts: ReadonlyArray<{ nickname: string; count: number }>,
): { nickname: string; bill: number }[] {
  const present = counts.filter((c) => c.count > 0);
  const freq = new Map<number, number>();
  for (const c of present) freq.set(c.count, (freq.get(c.count) ?? 0) + 1);
  const winners = present.filter((c) => freq.get(c.count) === 1).sort((a, b) => b.count - a.count);
  const sortedBills = [...bills].sort((a, b) => b - a);
  const awards: { nickname: string; bill: number }[] = [];
  for (let i = 0; i < winners.length && i < sortedBills.length; i++) {
    awards.push({ nickname: winners[i]!.nickname, bill: sortedBills[i]! });
  }
  return awards;
}

interface Casino {
  bills: number[]; // 내림차순
  dice: Map<string, number>; // 플레이어 → 이 카지노에 놓은 주사위 수
}

export interface LasVegasPayout {
  casino: number;
  awards: { nickname: string; bill: number }[];
}

/**
 * 라스베가스 엔진.
 *
 * 내부 상태:
 *  - order: 참가자 순서(이탈 시 축소). turnIdx는 order 안의 현재 차례 인덱스.
 *  - 불변식: !finished인 동안 order[turnIdx]는 항상 남은 주사위가 1개 이상이고 rolled에 그 사람의
 *    이번 턴 굴림이 들어 있다 — 그래서 pendingPlayers()는 !finished인 한 빈 배열을 반환하지 않는다.
 *  - deck: 게임 시작 때 한 번 섞은 지폐 덱. 라운드마다 앞에서부터 뽑아 쓰고, 정산 때 남은 지폐는
 *    버린다(덱으로 돌아가지 않음). 덱이 바닥나면 그 뒤 카지노는 $50,000 미만(혹은 빈 채)으로
 *    시작한다 — 54장이라 4라운드에 실제로 모자라는 일은 드물다.
 *  - money/billsWon: 번 돈은 모두에게 공개한다(원작은 지폐를 뒤집어 두지만, 여기서는 단순화).
 *
 * 턴 진행: 턴이 시작되면(beginTurn) 그 사람의 남은 주사위를 자동으로 굴린다. place(눈)로 그 눈의
 * 주사위를 전부 같은 번호 카지노에 놓고, 다음으로 주사위가 남은 사람에게 차례가 간다. 아무도
 * 주사위가 없으면 같은 handleAction 안에서 정산하고 다음 라운드를 시작(또는 게임 종료)한다.
 */
export class LasVegasEngine implements GameEngine {
  readonly game: GameId = 'lasVegas';
  readonly minPlayers = 2;

  private rng!: Rng;
  private order: string[] = [];
  private turnIdx = 0;
  private round = 1;
  private deck: number[] = [];
  private casinos: Casino[] = [];
  private diceLeft = new Map<string, number>();
  private rolled: number[] = [];
  private money = new Map<string, number>();
  private billsWon = new Map<string, number[]>();
  private lastPayout: LasVegasPayout[] | null = null;
  private finished = false;

  start(players: string[], _host: string, rng: Rng): void {
    this.rng = rng;
    this.order = [...players];
    this.round = 1;
    this.deck = shuffle(makeMoneyDeck(), rng);
    this.money = new Map(players.map((p) => [p, 0]));
    this.billsWon = new Map(players.map((p) => [p, []]));
    this.lastPayout = null;
    this.finished = this.order.length === 0;
    if (!this.finished) this.startRound();
  }

  // 라스베가스에는 host 게이팅 액션이 없다 — no-op.
  setHost(_host: string): void {}

  private rollDie(): number {
    return Math.floor(this.rng() * 6) + 1;
  }

  private startRound(): void {
    this.casinos = [];
    for (let c = 0; c < CASINO_COUNT; c++) {
      const bills: number[] = [];
      let total = 0;
      while (total < CASINO_MIN_TOTAL && this.deck.length > 0) {
        const bill = this.deck.shift()!;
        bills.push(bill);
        total += bill;
      }
      bills.sort((a, b) => b - a);
      this.casinos.push({ bills, dice: new Map() });
    }
    this.diceLeft = new Map(this.order.map((p) => [p, DICE_PER_PLAYER]));
    // 라운드 시작 플레이어는 라운드마다 한 자리씩 돌아간다.
    this.turnIdx = (this.round - 1) % this.order.length;
    this.beginTurn();
  }

  private beginTurn(): void {
    const n = this.diceLeft.get(this.order[this.turnIdx]!) ?? 0;
    this.rolled = Array.from({ length: n }, () => this.rollDie()).sort((a, b) => a - b);
  }

  /** from(포함)부터 한 바퀴 돌며 주사위가 남은 첫 사람의 인덱스. 없으면 -1. */
  private nextWithDice(from: number): number {
    const len = this.order.length;
    for (let k = 0; k < len; k++) {
      const i = (from + k) % len;
      if ((this.diceLeft.get(this.order[i]!) ?? 0) > 0) return i;
    }
    return -1;
  }

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.finished) return [];
    if (this.order[this.turnIdx] !== player) return [];
    if (action.name !== 'place') return [];
    const face = action.arg;
    if (typeof face !== 'number' || !Number.isInteger(face) || face < 1 || face > CASINO_COUNT) return [];
    const count = this.rolled.filter((d) => d === face).length;
    if (count === 0) return [];

    const casino = this.casinos[face - 1]!;
    casino.dice.set(player, (casino.dice.get(player) ?? 0) + count);
    this.diceLeft.set(player, (this.diceLeft.get(player) ?? 0) - count);
    const events: EngineEvent[] = [
      { text: `${player}님이 주사위 ${count}개를 ${face}번 카지노에 걸었습니다.` },
    ];
    events.push(...this.advance((this.turnIdx + 1) % this.order.length));
    return events;
  }

  /** from(포함)부터 주사위가 남은 다음 사람에게 차례를 넘기고, 아무도 없으면 라운드를 정산한다. */
  private advance(from: number): EngineEvent[] {
    const next = this.nextWithDice(from);
    if (next !== -1) {
      this.turnIdx = next;
      this.beginTurn();
      return [{ text: `${this.order[next]}님의 차례입니다.` }];
    }
    return this.endRound();
  }

  private endRound(): EngineEvent[] {
    const events: EngineEvent[] = [{ text: `라운드 ${this.round} 정산!` }];
    const payouts: LasVegasPayout[] = [];
    this.casinos.forEach((casino, i) => {
      const counts = [...casino.dice].map(([nickname, count]) => ({ nickname, count }));
      const awards = payout(casino.bills, counts);
      payouts.push({ casino: i + 1, awards });
      for (const a of awards) {
        this.money.set(a.nickname, (this.money.get(a.nickname) ?? 0) + a.bill);
        this.billsWon.get(a.nickname)?.push(a.bill);
      }
      if (awards.length > 0) {
        const list = awards.map((a) => `${a.nickname} ${formatMoney(a.bill)}`).join(', ');
        events.push({ text: `${i + 1}번 카지노: ${list}` });
      } else if (counts.length > 0) {
        events.push({ text: `${i + 1}번 카지노: 동점으로 모두 무효, 아무도 받지 못했습니다.` });
      }
    });
    this.lastPayout = payouts;

    if (this.round >= TOTAL_ROUNDS) {
      this.finished = true;
      this.rolled = [];
      events.push({ text: '게임 종료! 최종 결과를 확인하세요.' });
      return events;
    }
    this.round++;
    this.startRound();
    events.push({ text: `라운드 ${this.round} 시작! ${this.order[this.turnIdx]}님의 차례입니다.` });
    return events;
  }

  getViewFor(player: string): GameView {
    const turnPlayer = this.finished ? null : (this.order[this.turnIdx] ?? null);
    return {
      phase: 'place',
      yourActions: this.pendingPlayers().includes(player) ? ['place'] : [],
      round: this.round,
      totalRounds: TOTAL_ROUNDS,
      turnPlayer,
      dice: [...this.rolled],
      casinos: this.casinos.map((c, i) => ({
        number: i + 1,
        bills: [...c.bills],
        dice: [...c.dice].map(([nickname, count]) => ({ nickname, count })),
      })),
      players: this.order.map((p) => ({
        nickname: p,
        diceLeft: this.diceLeft.get(p) ?? 0,
        money: this.money.get(p) ?? 0,
        bills: this.billsWon.get(p)?.length ?? 0,
        isTurn: p === turnPlayer,
      })),
      lastPayout: this.lastPayout ? this.lastPayout.map((p) => ({ casino: p.casino, awards: [...p.awards] })) : null,
    };
  }

  pendingPlayers(): string[] {
    if (this.finished) return [];
    return [this.order[this.turnIdx]!];
  }

  // 순수 조회 — 가장 많이 나온 눈(동수면 큰 눈)을 건다. rolled는 비어 있지 않으므로 항상 합법이다.
  defaultAction(player: string): EngineAction | null {
    if (this.finished || this.order[this.turnIdx] !== player || this.rolled.length === 0) return null;
    let best = 0;
    let bestCount = 0;
    for (let face = 1; face <= CASINO_COUNT; face++) {
      const n = this.rolled.filter((d) => d === face).length;
      if (n > 0 && n >= bestCount) {
        best = face;
        bestCount = n;
      }
    }
    return { name: 'place', arg: best };
  }

  removePlayer(player: string): EngineEvent[] {
    const idx = this.order.indexOf(player);
    if (idx === -1 || this.finished) return [];

    const wasCurrentTurn = idx === this.turnIdx;
    this.order.splice(idx, 1);
    this.diceLeft.delete(player);
    this.money.delete(player);
    this.billsWon.delete(player);
    for (const c of this.casinos) c.dice.delete(player);
    if (idx < this.turnIdx) this.turnIdx--;

    const events: EngineEvent[] = [{ text: `${player}님이 게임을 떠났습니다.` }];
    if (this.order.length < 2) {
      this.finished = true;
      this.rolled = [];
      events.push({ text: '남은 인원이 부족해 게임을 종료합니다.' });
      return events;
    }
    if (wasCurrentTurn) {
      // 떠난 사람 자리에 온 다음 사람부터 주사위가 남은 사람을 찾는다(없으면 정산).
      events.push(...this.advance(this.turnIdx % this.order.length));
    }
    return events;
  }

  isFinished(): boolean {
    return this.finished;
  }

  // 돈 내림차순, 동률이면 지폐를 더 많이 가진 사람이 앞선다(이 구현의 결정).
  result(): { ranking: { nickname: string; detail: string }[] } | null {
    if (!this.finished) return null;
    const ranking = this.order
      .map((p) => ({ nickname: p, money: this.money.get(p) ?? 0, bills: this.billsWon.get(p)?.length ?? 0 }))
      .sort((a, b) => b.money - a.money || b.bills - a.bills)
      .map((r) => ({ nickname: r.nickname, detail: `${formatMoney(r.money)} (지폐 ${r.bills}장)` }));
    return { ranking };
  }
}

import type { Rng } from '../rng.js';
import { shuffle } from '../rng.js';
import { makeDeck, rankOf, type Card } from '../card.js';
import type { GameId, GameView } from '../protocol.js';
import type { GameEngine, EngineAction, EngineEvent } from '../engine.js';

const START_CHIPS = 1000;
const MIN_BET = 10;
const DEALER_STAND_TOTAL = 17;

export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 'A') {
      aces++;
      total += 1;
    } else if (['K', 'Q', 'J'].includes(r)) {
      total += 10;
    } else {
      total += Number(r);
    }
  }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return { total, soft };
}

interface Seat {
  hand: Card[];
  chips: number;
  bet: number;
  done: boolean;
  spectating: boolean;
}

type Phase = 'betting' | 'acting' | 'settle';

function fmtChips(n: number): string {
  return `칩 ${n.toLocaleString('ko-KR')}`;
}

function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21;
}

function isNaturalBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/**
 * 블랙잭 엔진.
 *
 * 내부 상태:
 *  - order: 게임에 참가 중인 전체 플레이어 순서(이탈 시 제거됨, 라운드 간 유지)
 *  - roundOrder: 이번 라운드에 실제로 참여하는(관전이 아닌) 플레이어 순서 — acting의 턴 순서
 *  - turnIdx: roundOrder에서 현재 턴인 인덱스
 *  - seats: 플레이어별 손패/칩/베팅/상태
 *  - dealerHand: 딜러 패 (2장 중 1장만 acting 동안 공개)
 *  - ready: settle에서 준비 완료한 플레이어 집합
 */
export class BlackjackEngine implements GameEngine {
  readonly game: GameId = 'blackjack';
  readonly minPlayers = 2;

  private rng!: Rng;
  private host = '';
  private order: string[] = [];
  private roundOrder: string[] = [];
  private turnIdx = 0;
  private seats = new Map<string, Seat>();
  private dealerHand: Card[] = [];
  private deck: Card[] = [];
  private phase: Phase = 'betting';
  private ready = new Set<string>();
  private finished = false;
  private finalResult: { ranking: { nickname: string; detail: string }[] } | null = null;

  start(players: string[], host: string, rng: Rng): void {
    this.rng = rng;
    this.host = host;
    this.order = [...players];
    this.seats = new Map(
      players.map((p) => [p, { hand: [], chips: START_CHIPS, bet: 0, done: false, spectating: false }]),
    );
    this.dealerHand = [];
    this.deck = [];
    this.roundOrder = [];
    this.turnIdx = 0;
    this.phase = 'betting';
    this.ready = new Set();
    this.finished = false;
    this.finalResult = null;
    this.beginBettingRound();
  }

  private beginBettingRound(): void {
    for (const p of this.order) {
      const seat = this.seats.get(p)!;
      seat.hand = [];
      seat.bet = 0;
      seat.done = false;
      seat.spectating = seat.chips === 0;
    }
    this.dealerHand = [];
    this.phase = 'betting';
    this.ready = new Set();
    this.roundOrder = [];
    this.turnIdx = 0;
  }

  private draw(): Card {
    if (this.deck.length === 0) {
      // 안전망: 이론상 한 라운드에서 52장을 다 쓰는 일은 없지만, 방어적으로 재보충한다.
      this.deck = shuffle(makeDeck(), this.rng);
    }
    return this.deck.pop()!;
  }

  private isBettingComplete(): boolean {
    return this.order.every((p) => {
      const s = this.seats.get(p)!;
      return s.spectating || s.bet > 0;
    });
  }

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.finished) return [];
    const seat = this.seats.get(player);
    if (!seat) return [];

    if (this.phase === 'betting') {
      if (action.name !== 'bet') return [];
      return this.doBet(player, seat, action.arg);
    }
    if (this.phase === 'acting') {
      if (this.roundOrder[this.turnIdx] !== player) return [];
      if (seat.done) return [];
      if (action.name === 'hit') return this.doHit(player, seat);
      if (action.name === 'stand') return this.doStand(player, seat);
      if (action.name === 'double') return this.doDouble(player, seat);
      return [];
    }
    if (this.phase === 'settle') {
      if (action.name === 'ready') return this.doReady(player);
      if (action.name === 'endGame') return this.doEndGame(player);
      return [];
    }
    return [];
  }

  private doBet(player: string, seat: Seat, arg: unknown): EngineEvent[] {
    if (seat.spectating) return [];
    if (seat.bet !== 0) return [];
    if (typeof arg !== 'number' || !Number.isInteger(arg)) return [];
    if (arg < MIN_BET || arg % 10 !== 0) return [];
    if (arg > seat.chips) return [];

    seat.bet = arg;
    seat.chips -= arg;
    const events: EngineEvent[] = [{ text: `${player}님이 ${arg.toLocaleString('ko-KR')}칩 베팅했습니다.` }];

    if (this.isBettingComplete()) {
      events.push(...this.dealRound());
    }
    return events;
  }

  private dealRound(): EngineEvent[] {
    this.deck = shuffle(makeDeck(), this.rng);
    this.roundOrder = this.order.filter((p) => !this.seats.get(p)!.spectating);
    const events: EngineEvent[] = [{ text: '딜러: 카드를 돌립니다.' }];

    if (this.roundOrder.length === 0) {
      this.phase = 'settle';
      this.ready = new Set();
      events.push({ text: '딜러: 이번 라운드에 베팅한 플레이어가 없습니다.' });
      return events;
    }

    // 라운드 로빈으로 두 장씩 배분: 플레이어들 → 딜러, 두 번 반복.
    for (let round = 0; round < 2; round++) {
      for (const p of this.roundOrder) {
        this.seats.get(p)!.hand.push(this.draw());
      }
      this.dealerHand.push(this.draw());
    }

    for (const p of this.roundOrder) {
      const seat = this.seats.get(p)!;
      if (isNaturalBlackjack(seat.hand)) {
        seat.done = true;
        events.push({ text: `${p}님 블랙잭!` });
      }
    }

    this.phase = 'acting';
    const firstIdx = this.roundOrder.findIndex((p) => !this.seats.get(p)!.done);
    if (firstIdx === -1) {
      this.turnIdx = this.roundOrder.length;
      events.push(...this.finishActingPhase());
    } else {
      this.turnIdx = firstIdx;
    }
    return events;
  }

  private doHit(player: string, seat: Seat): EngineEvent[] {
    seat.hand.push(this.draw());
    const { total } = handValue(seat.hand);
    const events: EngineEvent[] = [];
    if (total > 21) {
      seat.done = true;
      events.push({ text: `${player}님 버스트! (${total})` });
      events.push(...this.advanceTurn());
    } else {
      events.push({ text: `${player}님 히트 (합계 ${total})` });
    }
    return events;
  }

  private doStand(player: string, seat: Seat): EngineEvent[] {
    seat.done = true;
    const events: EngineEvent[] = [{ text: `${player}님 스탠드` }];
    events.push(...this.advanceTurn());
    return events;
  }

  private doDouble(player: string, seat: Seat): EngineEvent[] {
    if (seat.hand.length !== 2) return [];
    if (seat.chips < seat.bet) return [];
    seat.chips -= seat.bet;
    seat.bet *= 2;
    seat.hand.push(this.draw());
    seat.done = true;
    const { total } = handValue(seat.hand);
    const events: EngineEvent[] = [
      { text: `${player}님 더블다운! (베팅 ${seat.bet.toLocaleString('ko-KR')})` },
    ];
    if (total > 21) events.push({ text: `${player}님 버스트! (${total})` });
    events.push(...this.advanceTurn());
    return events;
  }

  /** roundOrder를 fromIdx(포함)부터 훑어 아직 done이 아닌 첫 인덱스를 찾는다. 없으면 -1. */
  private findNextIdx(fromIdx: number): number {
    for (let i = fromIdx; i < this.roundOrder.length; i++) {
      if (!this.seats.get(this.roundOrder[i])!.done) return i;
    }
    return -1;
  }

  private advanceTurn(): EngineEvent[] {
    const next = this.findNextIdx(this.turnIdx + 1);
    if (next === -1) {
      this.turnIdx = this.roundOrder.length;
      return this.finishActingPhase();
    }
    this.turnIdx = next;
    return [];
  }

  private finishActingPhase(): EngineEvent[] {
    const events: EngineEvent[] = [];
    const revealTotal = handValue(this.dealerHand).total;
    events.push({ text: `딜러: 카드를 공개합니다. (딜러 합계 ${revealTotal})` });
    while (handValue(this.dealerHand).total < DEALER_STAND_TOTAL) {
      this.dealerHand.push(this.draw());
      events.push({ text: `딜러 히트 (합계 ${handValue(this.dealerHand).total})` });
    }
    const dv = handValue(this.dealerHand);
    if (dv.total > 21) events.push({ text: `딜러 버스트! (${dv.total})` });
    else events.push({ text: `딜러 스탠드 (합계 ${dv.total})` });

    events.push(...this.settleRound());
    this.phase = 'settle';
    this.ready = new Set();
    return events;
  }

  private settleRound(): EngineEvent[] {
    const events: EngineEvent[] = [];
    const dealerTotal = handValue(this.dealerHand).total;
    const dealerBust = dealerTotal > 21;
    const dealerBJ = isNaturalBlackjack(this.dealerHand);

    for (const p of this.roundOrder) {
      const seat = this.seats.get(p)!;
      const bet = seat.bet;
      const playerBust = isBust(seat.hand);
      const playerTotal = handValue(seat.hand).total;
      const playerBJ = isNaturalBlackjack(seat.hand);

      if (playerBust) {
        events.push({ text: `${p}님 패배 (버스트, 베팅 ${bet.toLocaleString('ko-KR')} 상실)` });
      } else if (playerBJ && dealerBJ) {
        seat.chips += bet;
        events.push({ text: `${p}님 푸시 (둘 다 블랙잭)` });
      } else if (playerBJ) {
        const payout = bet + Math.round(bet * 1.5);
        seat.chips += payout;
        events.push({ text: `${p}님 블랙잭! 1.5배 승리 (+${(payout - bet).toLocaleString('ko-KR')})` });
      } else if (dealerBJ) {
        events.push({ text: `${p}님 패배 (딜러 블랙잭)` });
      } else if (dealerBust) {
        seat.chips += bet * 2;
        events.push({ text: `${p}님 승리! 딜러 버스트 (+${bet.toLocaleString('ko-KR')})` });
      } else if (playerTotal > dealerTotal) {
        seat.chips += bet * 2;
        events.push({ text: `${p}님 승리! (${playerTotal} vs ${dealerTotal})` });
      } else if (playerTotal === dealerTotal) {
        seat.chips += bet;
        events.push({ text: `${p}님 푸시 (${playerTotal} vs ${dealerTotal})` });
      } else {
        events.push({ text: `${p}님 패배 (${playerTotal} vs ${dealerTotal})` });
      }
      seat.bet = 0;
    }
    return events;
  }

  private doReady(player: string): EngineEvent[] {
    if (this.ready.has(player)) return [];
    this.ready.add(player);
    const events: EngineEvent[] = [{ text: `${player}님 준비 완료` }];
    if (this.order.every((p) => this.ready.has(p))) {
      this.beginBettingRound();
      events.push({ text: '다음 라운드! 베팅해주세요.' });
    }
    return events;
  }

  private doEndGame(player: string): EngineEvent[] {
    if (player !== this.host) return [];
    this.finish();
    return [{ text: '게임 종료! 최종 결과를 확인하세요.' }];
  }

  private finish(): void {
    this.finished = true;
    const ranking = this.order
      .map((p) => ({ nickname: p, chips: this.seats.get(p)!.chips }))
      .sort((a, b) => b.chips - a.chips)
      .map((r) => ({ nickname: r.nickname, detail: fmtChips(r.chips) }));
    this.finalResult = { ranking };
  }

  getViewFor(player: string): GameView {
    const seat = this.seats.get(player);
    const dealerHiddenCount =
      this.phase === 'acting' ? Math.max(this.dealerHand.length - 1, 0) : 0;
    const dealerHand =
      this.phase === 'betting' ? [] : this.phase === 'acting' ? this.dealerHand.slice(0, 1) : [...this.dealerHand];

    const others = this.order
      .filter((p) => p !== player)
      .map((p) => {
        const s = this.seats.get(p)!;
        return {
          nickname: p,
          handCount: s.hand.length,
          hand: this.phase === 'betting' ? [] : [...s.hand],
          chips: s.chips,
          bet: s.bet,
          isTurn: this.phase === 'acting' && this.roundOrder[this.turnIdx] === p,
          spectating: s.spectating,
        };
      });

    const you = seat
      ? {
          hand: [...seat.hand],
          chips: seat.chips,
          bet: seat.bet,
          spectating: seat.spectating,
        }
      : { hand: [], chips: 0, bet: 0, spectating: true };

    return {
      phase: this.phase,
      yourActions: this.yourActions(player),
      you,
      others,
      dealer: { hand: dealerHand, hiddenCount: dealerHiddenCount },
    };
  }

  private yourActions(player: string): string[] {
    if (this.finished) return [];
    const seat = this.seats.get(player);
    if (!seat) return [];

    if (this.phase === 'betting') {
      if (seat.spectating || seat.bet !== 0) return [];
      return ['bet'];
    }
    if (this.phase === 'acting') {
      if (this.roundOrder[this.turnIdx] !== player || seat.done) return [];
      const actions = ['hit', 'stand'];
      if (seat.hand.length === 2 && seat.chips >= seat.bet) actions.push('double');
      return actions;
    }
    if (this.phase === 'settle') {
      const actions: string[] = [];
      if (!this.ready.has(player)) actions.push('ready');
      if (player === this.host) actions.push('endGame');
      return actions;
    }
    return [];
  }

  pendingPlayers(): string[] {
    if (this.finished) return [];
    if (this.phase === 'betting') {
      return this.order.filter((p) => {
        const s = this.seats.get(p)!;
        return !s.spectating && s.bet === 0;
      });
    }
    if (this.phase === 'acting') {
      return this.turnIdx < this.roundOrder.length ? [this.roundOrder[this.turnIdx]] : [];
    }
    if (this.phase === 'settle') {
      return this.order.filter((p) => !this.ready.has(p));
    }
    return [];
  }

  defaultAction(player: string): EngineAction | null {
    if (this.finished) return null;
    const seat = this.seats.get(player);
    if (!seat) return null;

    if (this.phase === 'betting') {
      if (seat.spectating || seat.bet !== 0) return null;
      if (seat.chips < MIN_BET) {
        // 최소 베팅조차 할 수 없는 플레이어는 타임아웃 시 자동으로 관전 전환한다.
        seat.spectating = true;
        return null;
      }
      return { name: 'bet', arg: MIN_BET };
    }
    if (this.phase === 'acting') {
      if (this.roundOrder[this.turnIdx] !== player) return null;
      return { name: 'stand' };
    }
    if (this.phase === 'settle') {
      if (this.ready.has(player)) return null;
      return { name: 'ready' };
    }
    return null;
  }

  removePlayer(player: string): EngineEvent[] {
    if (!this.seats.has(player)) return [];
    const events: EngineEvent[] = [];

    if (this.phase === 'acting') {
      // roundOrder에서 즉시 splice해 인덱스를 맞춘 뒤 턴을 진행해야 한다 — advanceTurn()을
      // 먼저 부르고 나중에 filter하면 turnIdx가 옛 배열 기준으로 남아 다음 사람을 건너뛴다.
      const idx = this.roundOrder.indexOf(player);
      if (idx !== -1) {
        const wasCurrentTurn = idx === this.turnIdx && !this.seats.get(player)!.done;
        this.roundOrder.splice(idx, 1);
        if (idx < this.turnIdx) this.turnIdx--;
        events.push({ text: `${player}님 이탈로 자동 스탠드 처리` });
        if (wasCurrentTurn) {
          const next = this.findNextIdx(this.turnIdx);
          if (next === -1) {
            this.turnIdx = this.roundOrder.length;
            events.push(...this.finishActingPhase());
          } else {
            this.turnIdx = next;
          }
        }
      }
    } else {
      this.roundOrder = this.roundOrder.filter((p) => p !== player);
    }

    this.seats.delete(player);
    this.order = this.order.filter((p) => p !== player);
    this.ready.delete(player);
    events.push({ text: `${player}님이 게임을 떠났습니다.` });

    if (this.order.length <= 1) {
      this.finish();
      events.push({ text: '인원 부족으로 게임이 종료됩니다.' });
      return events;
    }

    if (this.phase === 'betting' && this.isBettingComplete()) {
      events.push(...this.dealRound());
    } else if (this.phase === 'settle' && this.order.every((p) => this.ready.has(p))) {
      this.beginBettingRound();
      events.push({ text: '다음 라운드! 베팅해주세요.' });
    }

    return events;
  }

  isFinished(): boolean {
    return this.finished;
  }

  result(): { ranking: { nickname: string; detail: string }[] } | null {
    return this.finalResult;
  }
}

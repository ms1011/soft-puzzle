import type { Rng } from '../rng.js';
import { shuffle } from '../rng.js';
import { makeDeck, rankOf, suitOf, type Card, type Suit } from '../card.js';
import type { GameId, GameView } from '../protocol.js';
import type { GameEngine, EngineAction, EngineEvent } from '../engine.js';

const HAND_SIZE = 7;
const BUST_THRESHOLD = 15;

const SUIT_LABELS: Record<Suit, string> = { S: '스페이드', H: '하트', D: '다이아', C: '클럽' };

function suitLabel(s: Suit): string {
  return SUIT_LABELS[s];
}

function describeCard(c: Card): string {
  if (c === 'JB') return '검은 조커';
  if (c === 'JR') return '빨간 조커';
  return `${suitLabel(suitOf(c)!)} ${rankOf(c)}`;
}

/** 공격 카드(2/A/조커)의 "종류" — 되받기는 같은 종류끼리만 가능하다(3 방어 없음). */
type AttackKind = '2' | 'A' | 'JOKER';

function attackKindOf(c: Card): AttackKind | null {
  const r = rankOf(c);
  if (r === '2') return '2';
  if (r === 'A') return 'A';
  if (r === 'JOKER') return 'JOKER';
  return null;
}

/** 공격 카드가 스택에 더하는 장수. 조커는 색에 따라 다르다(흑 5 / 적 7). */
function attackValue(c: Card): number {
  const r = rankOf(c);
  if (r === '2') return 2;
  if (r === 'A') return 3;
  if (c === 'JB') return 5;
  if (c === 'JR') return 7;
  return 0;
}

/**
 * card를 top 위에 낼 수 있는지 판정하는 순수 함수.
 *
 * - attackStack > 0: 공격이 걸려 있으므로 top과 같은 "종류"(2/A/조커)의 카드로만 되받을 수 있다.
 *   3 방어는 없고, 조커는 흑/적 상관없이 서로 되받을 수 있다.
 * - attackStack === 0 이고 top이 조커: 공격이 이미 해소된 뒤이므로 아무 카드나 낼 수 있다.
 * - 그 외: 현재 기준 무늬(declaredSuit ?? top의 무늬)와 같은 무늬이거나, top과 랭크가 같으면 된다.
 *   단, 내는 카드가 조커라면 조커 색 제약(흑조커는 검정 무늬/조커 위에만, 적조커는 빨강 무늬/조커
 *   위에만)을 대신 적용한다 — 조커는 애초에 무늬가 없어 일반 무늬/랭크 매칭 대상이 아니기 때문이다.
 */
export function canPlay(card: Card, top: Card, declaredSuit: Suit | null, attackStack: number): boolean {
  if (attackStack > 0) {
    const topKind = attackKindOf(top);
    const cardKind = attackKindOf(card);
    return cardKind !== null && cardKind === topKind;
  }

  if (rankOf(top) === 'JOKER') return true;

  const currentSuit = declaredSuit ?? suitOf(top);
  const cardRank = rankOf(card);

  if (cardRank === 'JOKER') {
    const currentIsRed = currentSuit === 'H' || currentSuit === 'D';
    return card === 'JR' ? currentIsRed : !currentIsRed;
  }

  return suitOf(card) === currentSuit || cardRank === rankOf(top);
}

type Outcome = 'finish' | 'bust';

/**
 * 원카드(One Card) 엔진. 54장(조커 포함), 각자 7장으로 시작.
 *
 * 내부 상태:
 *  - order: 현재 게임에 남아 있는(완주/파산/이탈하지 않은) 플레이어의 턴 순서.
 *    !ended인 동안 항상 order.length >= 2를 유지한다 — 그 아래로 줄어드는 순간
 *    finalizeIfDone()이 같은 호출 안에서 곧바로 게임을 끝내기 때문에, 밖에서 관측할 수 있는
 *    "아무도 대기 중이 아닌데 안 끝난" 상태는 없다.
 *  - turnIdx/direction: order 안에서 현재 턴과 진행 방향(Q로 뒤집힘, 2인전에서는 사실상 무의미).
 *  - hands: 플레이어별 손패. 완주/파산/이탈한 플레이어는 즉시 이 맵에서 삭제된다.
 *  - drawPile/discard/top: top이 현재 판의 카드이고, discard는 top 밑에 쌓인 지난 카드들이다.
 *    drawPile이 바닥나면 discard(= top 제외)를 재셔플해 drawPile로 되돌린다.
 *  - declaredSuit/attackStack: 7 선언 무늬와 누적 공격 스택. 7이 아닌 카드가 top이 되는 순간
 *    declaredSuit는 항상 null로 리셋된다.
 *  - finished/busted: 각각 완주 순서, 파산(탈락) 순서로 쌓이는 닉네임 목록. 최종 랭킹은
 *    [...finished, ...busted를 뒤집은 것] 이다 — 나중에 탈락한 사람이 먼저 탈락한 사람보다 위.
 *
 * 턴 진행: doPlay/doDraw가 호출된 즉시(같은 handleAction 호출 안에서) 완주/파산 여부를 확정하고
 * 다음 턴 혹은 게임 종료까지 처리한다 — 그 사이에 관측 가능한 중간 상태가 없다.
 */
export class OneCardEngine implements GameEngine {
  readonly game: GameId = 'onecard';
  readonly minPlayers = 2;

  private rng!: Rng;
  private order: string[] = [];
  private turnIdx = 0;
  private direction: 1 | -1 = 1;
  private hands = new Map<string, Card[]>();
  private drawPile: Card[] = [];
  private discard: Card[] = [];
  private top: Card = '';
  private declaredSuit: Suit | null = null;
  private attackStack = 0;
  private finished: string[] = [];
  private busted: string[] = [];
  private ended = false;

  start(players: string[], _host: string, rng: Rng): void {
    this.rng = rng;
    this.order = [...players];
    this.turnIdx = 0;
    this.direction = 1;
    this.hands = new Map(players.map((p) => [p, [] as Card[]]));
    this.discard = [];
    this.finished = [];
    this.busted = [];
    this.ended = false;
    this.declaredSuit = null;
    this.attackStack = 0;

    const deck = shuffle(makeDeck({ jokers: true }), rng);
    for (let round = 0; round < HAND_SIZE; round++) {
      for (const p of this.order) {
        this.hands.get(p)!.push(deck.pop()!);
      }
    }
    this.top = deck.pop()!;
    this.drawPile = deck;
  }

  /** @internal 테스트 전용 — 결정적 시나리오 구성을 위해 손패와 top을 직접 지정한다. 공개 API 아님. */
  setHands(hands: Map<string, Card[]>, top: Card): void {
    for (const [p, cards] of hands) {
      this.hands.set(p, [...cards]);
    }
    this.top = top;
    this.declaredSuit = null;
    this.attackStack = 0;
  }

  private drawCard(): Card | null {
    if (this.drawPile.length === 0) {
      if (this.discard.length === 0) return null;
      this.drawPile = shuffle(this.discard, this.rng);
      this.discard = [];
    }
    return this.drawPile.pop() ?? null;
  }

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.ended) return [];
    if (this.order[this.turnIdx] !== player) return [];
    if (action.name === 'play') return this.doPlay(player, action.arg);
    if (action.name === 'draw') return this.doDraw(player);
    return [];
  }

  private doPlay(player: string, arg: unknown): EngineEvent[] {
    const hand = this.hands.get(player);
    if (!hand) return [];
    if (typeof arg !== 'object' || arg === null) return [];
    const a = arg as Record<string, unknown>;
    const card = a.card;
    if (typeof card !== 'string' || !hand.includes(card)) return [];
    if (!canPlay(card, this.top, this.declaredSuit, this.attackStack)) return [];

    const rank = rankOf(card);
    let declared: Suit | null = null;
    if (rank === '7') {
      const ds = a.declareSuit;
      if (ds !== 'S' && ds !== 'H' && ds !== 'D' && ds !== 'C') return [];
      declared = ds;
    }

    // ---- 검증 끝. 여기서부터 상태를 바꾼다. ----
    hand.splice(hand.indexOf(card), 1);
    this.discard.push(this.top);
    this.top = card;
    this.declaredSuit = declared;

    const events: EngineEvent[] = [{ text: `${player}님이 ${describeCard(card)}을(를) 냈습니다.` }];
    const willFinish = hand.length === 0;
    const isAttack = rank === '2' || rank === 'A' || card === 'JB' || card === 'JR';

    if (isAttack) {
      this.attackStack += attackValue(card);
      events.push({
        text: `공격! 다음 사람은 ${this.attackStack}장을 받거나 같은 종류로 되받아야 합니다.`,
      });
    } else if (rank === 'J') {
      events.push({ text: '다음 차례가 건너뛰어집니다.' });
    } else if (rank === 'Q') {
      if (this.order.length > 2) {
        this.direction = this.direction === 1 ? -1 : 1;
        events.push({ text: '진행 방향이 바뀌었습니다.' });
      }
    } else if (rank === 'K') {
      if (!willFinish) events.push({ text: `${player}님이 한 번 더 진행합니다.` });
    } else if (rank === '7') {
      events.push({ text: `${player}님이 ${suitLabel(declared!)} 무늬를 선언했습니다.` });
    }

    let steps: number;
    if (rank === 'J') steps = 2;
    else if (rank === 'K' && !willFinish) steps = 0;
    else steps = 1;

    this.advanceTurn(steps, willFinish ? 'finish' : null, player);

    if (willFinish) events.push({ text: `${player}님 완주!` });
    if (this.ended) events.push({ text: '게임 종료! 최종 결과를 확인하세요.' });
    return events;
  }

  private doDraw(player: string): EngineEvent[] {
    const hand = this.hands.get(player)!;
    const wasAttacked = this.attackStack > 0;
    const need = wasAttacked ? this.attackStack : 1;
    let drawn = 0;
    for (let i = 0; i < need; i++) {
      const c = this.drawCard();
      if (c === null) break;
      hand.push(c);
      drawn++;
    }

    const events: EngineEvent[] = [];
    if (wasAttacked) {
      this.attackStack = 0;
      events.push({ text: `${player}님이 공격을 막지 못해 ${drawn}장을 뽑았습니다.` });
    } else {
      events.push({ text: `${player}님이 카드를 뽑았습니다.` });
    }

    const busted = hand.length >= BUST_THRESHOLD;
    if (busted) {
      events.push({ text: `${player}님 파산! 카드가 ${hand.length}장이 되어 탈락합니다.` });
    }
    this.advanceTurn(1, busted ? 'bust' : null, player);
    if (this.ended) events.push({ text: '게임 종료! 최종 결과를 확인하세요.' });
    return events;
  }

  /**
   * 카드를 내거나 뽑은 뒤 턴을 넘긴다.
   *
   * outcome이 있으면(완주/파산) 그 플레이어를 order에서 제거한다. 인덱스를 직접 산술로 보정하는
   * 대신, "제거 전" 배열/turnIdx 기준으로 steps만큼 이동한 다음 플레이어의 이름을 먼저 구해 두고
   * 나서 실제로 제거를 수행한 뒤 새 배열에서 그 이름을 다시 찾는다 — direction 반전이 섞여도
   * 항상 정확하고, 인덱스 오프바이원 버그의 여지가 없다.
   *
   * order.length가 제거 후 1명 이하로 줄면 finalizeIfDone()이 이 함수 안에서 즉시 게임을 끝내므로
   * (그 사람도 함께 완주 랭킹에 등록된다) 다음 플레이어 이름 조회는 건너뛴다. 이 경로가 아니면
   * order.length는 항상 2 이상으로 유지되므로, steps<=2인 이 함수에서 다음 이름이 "방금 제거한
   * 그 사람 자신"이 되는 경우는 없다(제거 후 인원이 1명이 되는 유일한 경우는 이미 위에서 걸러진다).
   */
  private advanceTurn(steps: number, outcome: Outcome | null, player: string): void {
    if (outcome) {
      const n = this.order.length;
      const nextIdx = (((this.turnIdx + steps * this.direction) % n) + n) % n;
      const nextName = this.order[nextIdx];

      this.order.splice(this.turnIdx, 1);
      this.hands.delete(player);
      (outcome === 'finish' ? this.finished : this.busted).push(player);
      this.finalizeIfDone();

      if (!this.ended) {
        this.turnIdx = this.order.indexOf(nextName);
      }
      return;
    }

    if (steps !== 0) {
      const n = this.order.length;
      this.turnIdx = (((this.turnIdx + steps * this.direction) % n) + n) % n;
    }
  }

  /** order.length가 1명으로 줄면 그 사람도 완주(마지막 생존자)로 등록하고 게임을 끝낸다. */
  private finalizeIfDone(): void {
    if (this.order.length === 1) {
      this.finished.push(this.order[0]);
      this.order = [];
    }
    if (this.order.length === 0) {
      this.ended = true;
    }
  }

  getViewFor(player: string): GameView {
    const hand = this.hands.get(player) ?? [];
    const turnPlayer = this.ended ? null : (this.order[this.turnIdx] ?? null);

    const others = this.order
      .filter((p) => p !== player)
      .map((p) => ({
        nickname: p,
        handCount: this.hands.get(p)?.length ?? 0,
        isTurn: p === turnPlayer,
      }));

    return {
      phase: this.ended ? 'result' : 'playing',
      yourActions: this.yourActions(player),
      you: {
        hand: [...hand],
        handCount: hand.length,
        isTurn: player === turnPlayer,
      },
      others,
      top: this.top,
      declaredSuit: this.declaredSuit,
      attackStack: this.attackStack,
      direction: this.direction,
    };
  }

  private yourActions(player: string): string[] {
    if (this.ended) return [];
    if (this.order[this.turnIdx] !== player) return [];
    return ['play', 'draw'];
  }

  pendingPlayers(): string[] {
    if (this.ended) return [];
    return this.order.length > 0 ? [this.order[this.turnIdx]] : [];
  }

  // 순수 조회 메서드다 — 상태를 절대 변경하지 않는다(Room이 타이머 렌더링을 위해 몇 번을
  // 호출하든, 실제 자동 처리 전에 미리 호출하든 안전해야 한다). 스펙에 명시된 대로 draw 고정.
  defaultAction(player: string): EngineAction | null {
    if (this.ended) return null;
    if (this.order[this.turnIdx] !== player) return null;
    return { name: 'draw' };
  }

  removePlayer(player: string): EngineEvent[] {
    const idx = this.order.indexOf(player);
    if (idx === -1) return [];

    const wasCurrentTurn = idx === this.turnIdx;
    const events: EngineEvent[] = [{ text: `${player}님이 게임을 떠났습니다.` }];

    let nextName: string | null = null;
    if (wasCurrentTurn) {
      const n = this.order.length;
      const nextIdx = (((this.turnIdx + this.direction) % n) + n) % n;
      nextName = this.order[nextIdx];
    }

    this.order.splice(idx, 1);
    this.hands.delete(player);
    if (!wasCurrentTurn && idx < this.turnIdx) this.turnIdx--;

    this.finalizeIfDone();
    if (!this.ended && wasCurrentTurn) {
      this.turnIdx = this.order.indexOf(nextName!);
    }
    if (this.ended) events.push({ text: '인원 부족으로 게임이 종료됩니다.' });
    return events;
  }

  isFinished(): boolean {
    return this.ended;
  }

  result(): { ranking: { nickname: string; detail: string }[] } | null {
    if (!this.ended) return null;
    return {
      ranking: [
        ...this.finished.map((p) => ({ nickname: p, detail: '완주' })),
        ...[...this.busted].reverse().map((p) => ({ nickname: p, detail: '파산 탈락' })),
      ],
    };
  }
}

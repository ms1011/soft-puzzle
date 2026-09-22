import type { EngineAction, EngineEvent, GameEngine } from '../engine.js';
import type { GameId, GameView } from '../protocol.js';
import type { Rng } from '../rng.js';
import { shuffle } from '../rng.js';
import type { Card } from '../card.js';
import { makeDeck, rankOf } from '../card.js';

/** 한 덱(52장)을 모두 소진할 때까지 라운드를 반복하는 인디언 포커. */
export class IndianPokerEngine implements GameEngine {
  readonly game: GameId = 'indianPoker';
  readonly minPlayers = 2;
  private players: string[] = [];
  private deck: Card[] = [];
  private cards = new Map<string, Card>();
  private scores = new Map<string, number>();
  private chips = new Map<string, number>();
  private pot = 0;
  private folded = new Set<string>();
  private acted = new Set<string>();
  private turn = 0;
  private starter = 0;
  private round = 0;
  private finished = false;

  start(players: string[], _host: string, rng: Rng): void {
    this.players = [...players];
    this.deck = shuffle(makeDeck(), rng);
    this.scores = new Map(players.map((player) => [player, 0]));
    this.chips = new Map(players.map((player) => [player, 52]));
    this.starter = 0;
    this.round = 0;
    this.finished = false;
    this.dealRound();
  }
  setHost(_host: string): void {}

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.finished || this.players[this.turn] !== player || this.folded.has(player) || !['call', 'fold'].includes(action.name)) return [];
    this.acted.add(player);
    if (action.name === 'fold') this.folded.add(player);
    else {
      this.chips.set(player, (this.chips.get(player) ?? 0) - 1);
      this.pot++;
    }
    const active = this.players.filter((p) => !this.folded.has(p));
    if (active.length === 1 || this.acted.size === this.players.length) return this.finishRound(active);
    do { this.turn = (this.turn + 1) % this.players.length; } while (this.folded.has(this.players[this.turn]!));
    return [{ text: `${player}님이 ${action.name === 'call' ? '콜' : '폴드'}했습니다.` }];
  }

  getViewFor(player: string): GameView {
    return {
      phase: this.finished ? 'result' : 'betting',
      yourActions: !this.finished && this.players[this.turn] === player ? ['call', 'fold'] : [],
      yourCard: '?',
      round: this.round,
      remainingCards: this.deck.length,
      scores: this.players.map((p) => ({ nickname: p, score: this.scores.get(p) ?? 0 })),
      chips: this.players.map((p) => ({ nickname: p, chips: this.chips.get(p) ?? 0 })),
      pot: this.pot,
      others: this.players.filter((p) => p !== player).map((p) => ({ nickname: p, card: this.cards.get(p), folded: this.folded.has(p), isTurn: this.players[this.turn] === p })),
      isTurn: this.players[this.turn] === player,
    };
  }
  pendingPlayers(): string[] { return this.finished ? [] : [this.players[this.turn]!]; }
  defaultAction(player: string): EngineAction | null { return this.players[this.turn] === player ? { name: 'call' } : null; }

  removePlayer(player: string): EngineEvent[] {
    if (this.finished || !this.players.includes(player)) return [];
    const currentPlayer = this.players[this.turn];
    this.players = this.players.filter((p) => p !== player);
    this.cards.delete(player); this.scores.delete(player); this.chips.delete(player); this.folded.delete(player); this.acted.delete(player);
    if (this.players.length < this.minPlayers) { this.finished = true; return [{ text: '참가자가 부족해 게임을 종료합니다.' }]; }
    const active = this.players.filter((p) => !this.folded.has(p));
    if (active.length === 1 || this.acted.size === this.players.length) return this.finishRound(active);
    if (currentPlayer === player) this.turn = Math.min(this.turn, this.players.length - 1);
    else this.turn = Math.max(0, this.players.indexOf(currentPlayer!));
    while (this.folded.has(this.players[this.turn]!)) this.turn = (this.turn + 1) % this.players.length;
    return [{ text: `${player}님이 게임을 떠났습니다.` }];
  }
  isFinished(): boolean { return this.finished; }
  result(): { ranking: { nickname: string; detail: string }[] } | null {
    if (!this.finished) return null;
    return { ranking: [...this.players].sort((a, b) => (this.chips.get(b) ?? 0) - (this.chips.get(a) ?? 0)).map((p) => ({ nickname: p, detail: `${this.chips.get(p) ?? 0}칩 · ${this.scores.get(p) ?? 0}승` })) };
  }

  private dealRound(): void {
    this.round++;
    this.cards = new Map(this.players.map((player) => [player, this.deck.pop()!]));
    this.folded = new Set(); this.acted = new Set();
    this.pot = this.players.length;
    for (const player of this.players) this.chips.set(player, (this.chips.get(player) ?? 0) - 1);
    this.turn = this.starter % this.players.length;
    this.starter = (this.starter + 1) % this.players.length;
  }

  private finishRound(active: string[]): EngineEvent[] {
    const best = Math.max(...active.map((player) => cardValue(this.cards.get(player)!)));
    const winners = active.filter((player) => cardValue(this.cards.get(player)!) === best);
    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot % winners.length;
    for (const winner of winners) {
      this.scores.set(winner, (this.scores.get(winner) ?? 0) + 1);
      this.chips.set(winner, (this.chips.get(winner) ?? 0) + share + (remainder-- > 0 ? 1 : 0));
    }
    const reveal = this.players.map((p) => `${p} ${this.cards.get(p)}`).join(', ');
    const winnerText = winners.length === 1 ? `${winners[0]}님 승리` : `${winners.join('·')}님 공동 승리`;
    if (this.deck.length < this.players.length) {
      this.finished = true;
      return [{ text: `라운드 ${this.round}: ${winnerText}. 카드: ${reveal}. 덱을 모두 사용해 게임이 끝났습니다.` }];
    }
    this.dealRound();
    return [{ text: `라운드 ${this.round - 1}: ${winnerText}. 카드: ${reveal}. 다음 라운드를 시작합니다.` }];
  }
}

function cardValue(card: Card): number {
  const rank = rankOf(card);
  if (rank === 'A') return 14;
  if (rank === 'K') return 13;
  if (rank === 'Q') return 12;
  if (rank === 'J') return 11;
  return Number(rank);
}

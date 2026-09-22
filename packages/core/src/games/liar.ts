import type { EngineAction, EngineEvent, GameEngine } from '../engine.js';
import type { GameId, GameView } from '../protocol.js';
import type { Rng } from '../rng.js';
import { shuffle } from '../rng.js';

const WORDS = ['바다', '피자', '학교', '고양이', '영화관', '캠핑', '축구', '커피'];

/** 비밀 제시어를 알고 있는 시민과, 제시어를 모르는 라이어의 한 번 투표 게임. */
export class LiarEngine implements GameEngine {
  readonly game: GameId = 'liar';
  readonly minPlayers = 3;
  private players: string[] = [];
  private liar = '';
  private word = '';
  private votes = new Map<string, string>();
  private finished = false;
  private winner: 'citizen' | 'liar' | null = null;

  start(players: string[], _host: string, rng: Rng): void {
    this.players = [...players];
    this.liar = shuffle(players, rng)[0] ?? '';
    this.word = shuffle(WORDS, rng)[0] ?? WORDS[0]!;
    this.votes = new Map();
    this.finished = false;
    this.winner = null;
  }
  setHost(_host: string): void {}

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.finished || action.name !== 'vote' || this.votes.has(player) || typeof action.arg !== 'string') return [];
    if (!this.players.includes(player) || !this.players.includes(action.arg) || player === action.arg) return [];
    this.votes.set(player, action.arg);
    if (this.votes.size < this.players.length) return [{ text: `${player}님이 투표했습니다. 대화를 나눈 뒤 모두 투표하세요.` }];
    return this.finishVote();
  }

  private finishVote(): EngineEvent[] {
    const totals = new Map<string, number>();
    for (const target of this.votes.values()) totals.set(target, (totals.get(target) ?? 0) + 1);
    let max = 0;
    let targets: string[] = [];
    for (const [target, count] of totals) {
      if (count > max) { max = count; targets = [target]; }
      else if (count === max) targets.push(target);
    }
    const caught = targets.length === 1 && targets[0] === this.liar;
    this.winner = caught ? 'citizen' : 'liar';
    this.finished = true;
    return [{ text: `정답 공개 — 제시어: ${this.word}, 라이어: ${this.liar}. ${caught ? '시민 팀 승리!' : '라이어 팀 승리!'}` }];
  }

  getViewFor(player: string): GameView {
    return {
      phase: this.finished ? 'result' : 'voting',
      yourActions: !this.finished && !this.votes.has(player) ? ['vote'] : [],
      yourWord: player === this.liar ? '라이어 (제시어를 모릅니다)' : this.word,
      players: this.players,
      hasVoted: this.votes.has(player),
    };
  }
  pendingPlayers(): string[] { return this.finished ? [] : this.players.filter((p) => !this.votes.has(p)); }
  defaultAction(player: string): EngineAction | null {
    const target = this.players.find((p) => p !== player);
    return target === undefined || this.votes.has(player) ? null : { name: 'vote', arg: target };
  }
  removePlayer(player: string): EngineEvent[] {
    if (!this.players.includes(player) || this.finished) return [];
    this.players = this.players.filter((p) => p !== player);
    this.votes.delete(player);
    if (player === this.liar) { this.finished = true; this.winner = 'citizen'; return [{ text: '라이어가 나가 시민 팀 승리입니다.' }]; }
    // 떠난 사람을 대상으로 한 표는 무효다. 해당 투표자는 남은 사람 중에서 다시 고른다.
    for (const [voter, target] of this.votes) if (target === player) this.votes.delete(voter);
    if (this.votes.size === this.players.length) return this.finishVote();
    return [{ text: `${player}님이 게임을 떠났습니다.` }];
  }
  isFinished(): boolean { return this.finished; }
  result(): { ranking: { nickname: string; detail: string }[] } | null {
    if (!this.finished || this.winner === null) return null;
    return { ranking: this.players.map((p) => ({ nickname: p, detail: `${p === this.liar ? '라이어' : '시민'}${(p === this.liar ? 'liar' : 'citizen') === this.winner ? ' · 승리' : ''}` })) };
  }
}

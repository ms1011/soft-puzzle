import type { GameEngine, EngineAction, EngineEvent } from '../engine.js';
import type { GameId, GameView } from '../protocol.js';
import type { Rng } from '../rng.js';
import { shuffle } from '../rng.js';

type Role = 'mafia' | 'citizen';
type Phase = 'night' | 'day';

/**
 * 간결한 마피아 엔진. 밤에는 살아 있는 마피아가 같은 목표를 고르고, 낮에는 살아 있는
 * 전원이 투표한다. 가장 많은 표를 받은 사람이 탈락하며 동률이면 아무도 탈락하지 않는다.
 * 역할은 getViewFor에서 본인에게만 전송한다.
 */
export class MafiaEngine implements GameEngine {
  readonly game: GameId = 'mafia';
  readonly minPlayers = 4;

  private players: string[] = [];
  private roles = new Map<string, Role>();
  private alive = new Set<string>();
  private phase: Phase = 'night';
  private votes = new Map<string, string>();
  private finished = false;
  private winner: Role | null = null;

  start(players: string[], _host: string, rng: Rng): void {
    this.players = [...players];
    this.alive = new Set(players);
    this.roles = new Map(players.map((p) => [p, 'citizen']));
    const mafiaCount = Math.max(1, Math.floor(players.length / 3));
    for (const p of shuffle([...players], rng).slice(0, mafiaCount)) this.roles.set(p, 'mafia');
    this.phase = 'night';
    this.votes = new Map();
    this.finished = false;
    this.winner = null;
  }

  setHost(_host: string): void {}

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.finished || action.name !== 'vote' || !this.canVote(player)) return [];
    if (typeof action.arg !== 'string' || !this.alive.has(action.arg) || action.arg === player) return [];
    this.votes.set(player, action.arg);
    const events: EngineEvent[] = [{ text: `${player}님이 투표했습니다.` }];
    if (this.pendingPlayers().length === 0) events.push(...this.resolveVotes());
    return events;
  }

  private canVote(player: string): boolean {
    if (!this.alive.has(player) || this.votes.has(player)) return false;
    return this.phase === 'day' || this.roles.get(player) === 'mafia';
  }

  private resolveVotes(): EngineEvent[] {
    const totals = new Map<string, number>();
    for (const target of this.votes.values()) totals.set(target, (totals.get(target) ?? 0) + 1);
    let max = 0;
    let targets: string[] = [];
    for (const [target, count] of totals) {
      if (count > max) { max = count; targets = [target]; }
      else if (count === max) targets.push(target);
    }
    const events: EngineEvent[] = [];
    if (targets.length === 1 && targets[0] !== undefined) {
      const target = targets[0];
      this.alive.delete(target);
      events.push({ text: `${target}님이 ${this.phase === 'night' ? '밤사이' : '투표로'} 탈락했습니다. 역할: ${this.roles.get(target) === 'mafia' ? '마피아' : '시민'}` });
    } else {
      events.push({ text: `${this.phase === 'night' ? '마피아의 목표' : '투표'}가 동률이라 아무도 탈락하지 않았습니다.` });
    }
    if (this.checkFinished(events)) return events;
    this.phase = this.phase === 'night' ? 'day' : 'night';
    this.votes = new Map();
    events.push({ text: this.phase === 'night' ? '밤이 되었습니다. 마피아는 처치할 대상을 고르세요.' : '낮이 되었습니다. 생존자 모두 투표하세요.' });
    return events;
  }

  private checkFinished(events: EngineEvent[]): boolean {
    const mafia = [...this.alive].filter((p) => this.roles.get(p) === 'mafia').length;
    const citizens = this.alive.size - mafia;
    if (mafia === 0) this.winner = 'citizen';
    else if (mafia >= citizens) this.winner = 'mafia';
    else return false;
    this.finished = true;
    events.push({ text: `게임 종료! ${this.winner === 'mafia' ? '마피아' : '시민'} 팀의 승리입니다.` });
    return true;
  }

  getViewFor(player: string): GameView {
    const role = this.roles.get(player) ?? 'citizen';
    return {
      phase: this.finished ? 'result' : this.phase,
      yourActions: this.canVote(player) ? ['vote'] : [],
      yourRole: role,
      phaseLabel: this.phase === 'night' ? '밤' : '낮',
      alive: this.players.map((nickname) => ({ nickname, alive: this.alive.has(nickname), role: this.alive.has(nickname) ? undefined : this.roles.get(nickname) })),
      hasVoted: this.votes.has(player),
    };
  }

  pendingPlayers(): string[] { return this.finished ? [] : this.players.filter((p) => this.canVote(p)); }

  defaultAction(player: string): EngineAction | null {
    const target = this.players.find((p) => p !== player && this.alive.has(p));
    return this.canVote(player) && target ? { name: 'vote', arg: target } : null;
  }

  removePlayer(player: string): EngineEvent[] {
    if (!this.alive.delete(player)) return [];
    const events = [{ text: `${player}님이 게임을 떠나 탈락 처리되었습니다.` }];
    if (!this.checkFinished(events)) {
      if (this.pendingPlayers().length === 0) events.push(...this.resolveVotes());
    }
    return events;
  }

  isFinished(): boolean { return this.finished; }

  result(): { ranking: { nickname: string; detail: string }[] } | null {
    if (!this.finished || this.winner === null) return null;
    return { ranking: this.players.map((nickname) => ({ nickname, detail: `${this.roles.get(nickname) === 'mafia' ? '마피아' : '시민'}${this.roles.get(nickname) === this.winner ? ' · 승리' : ''}` })) };
  }
}

import type { GameEngine, EngineAction, EngineEvent, ChatRoute, FocusRoute } from '../engine.js';
import { focusField } from '../engine.js';
import type { ChatChannel, GameId, GameView } from '../protocol.js';
import type { Rng } from '../rng.js';
import { shuffle } from '../rng.js';

export type MafiaSpecialRole = 'doctor' | 'police' | 'detective';
type Role = 'mafia' | 'citizen' | MafiaSpecialRole;
type Phase = 'night' | 'day';

export interface MafiaSettings {
  mafiaCount: number;
  specialRoles: MafiaSpecialRole[];
}

const ROLE_LABELS: Record<Role, string> = {
  mafia: '마피아', citizen: '시민', doctor: '의사', police: '경찰', detective: '탐정',
};

/** 마피아는 한 명 이상이며 전체 인원의 절반보다 적어야 한다. */
export function isValidMafiaCount(playerCount: number, mafiaCount: number): boolean {
  return Number.isInteger(mafiaCount) && mafiaCount >= 1 && mafiaCount < playerCount / 2;
}

/** 밤에는 마피아·선택된 특수직업이 행동하고, 낮에는 생존자 전원이 투표한다. */
export class MafiaEngine implements GameEngine {
  readonly game: GameId = 'mafia';
  readonly minPlayers = 4;
  private players: string[] = [];
  private roles = new Map<string, Role>();
  private alive = new Set<string>();
  private phase: Phase = 'night';
  /** 몇 일차인지. 1일차 밤에서 시작하고, 낮이 끝나 밤이 될 때 하루가 늘어난다. */
  private day = 1;
  private actions = new Map<string, string>();
  private investigationResults = new Map<string, string>();
  private finished = false;
  private winner: 'mafia' | 'citizen' | null = null;

  constructor(private readonly settings?: MafiaSettings) {}

  start(players: string[], _host: string, rng: Rng): void {
    this.players = [...players];
    this.alive = new Set(players);
    this.roles = new Map(players.map((p) => [p, 'citizen']));
    const mafiaCount = this.settings?.mafiaCount ?? Math.max(1, Math.floor(players.length / 3));
    const shuffledPlayers = shuffle([...players], rng);
    const mafia = shuffledPlayers.slice(0, mafiaCount);
    for (const player of mafia) this.roles.set(player, 'mafia');

    const enabledRoles = [...new Set(this.settings?.specialRoles ?? [])];
    // 시민도 하나의 역할로 반드시 배정될 수 있어야 한다. 따라서 마피아를 제외한 자리를
    // 특수직업으로 모두 채우지 않고 최소 한 자리는 시민에게 남긴다. 특수직업은 종류별 1명뿐이다.
    const specialSlots = Math.max(0, players.length - mafia.length - 1);
    const specialRoles = shuffle(enabledRoles, rng).slice(0, specialSlots);
    const specialPlayers = shuffle(shuffledPlayers.slice(mafia.length), rng);
    specialRoles.forEach((role, index) => {
      const player = specialPlayers[index];
      if (player !== undefined) this.roles.set(player, role);
    });

    this.phase = 'night';
    this.day = 1;
    this.actions = new Map();
    this.investigationResults = new Map();
    this.finished = false;
    this.winner = null;
  }

  setHost(_host: string): void {}

  handleAction(player: string, action: EngineAction): EngineEvent[] {
    const expected = this.roleAction(player);
    if (this.finished || expected === null || this.actions.has(player)) return [];
    if (action.name !== expected || typeof action.arg !== 'string' || !this.alive.has(action.arg)) return [];
    if (action.arg === player && expected !== 'protect') return [];
    this.actions.set(player, action.arg);
    if (this.pendingPlayers().length > 0) return [{ text: `${player}님이 행동을 완료했습니다.` }];
    return this.phase === 'night' ? this.resolveNight() : this.resolveDay();
  }

  private roleAction(player: string): string | null {
    if (!this.alive.has(player)) return null;
    if (this.phase === 'day') return 'vote';
    switch (this.roles.get(player)) {
      case 'mafia': return 'mafiaVote';
      case 'doctor': return 'protect';
      case 'police': return 'investigateMafia';
      case 'detective': return 'investigateRole';
      default: return null;
    }
  }

  private resolveNight(): EngineEvent[] {
    const events: EngineEvent[] = [];
    const protectedPlayer = this.targetForAction('protect');
    const police = this.playerForAction('investigateMafia');
    const detective = this.playerForAction('investigateRole');
    if (police) {
      const target = this.actions.get(police)!;
      this.investigationResults.set(police, `${target}님은 ${this.roles.get(target) === 'mafia' ? '마피아입니다.' : '마피아가 아닙니다.'}`);
    }
    if (detective) {
      const target = this.actions.get(detective)!;
      this.investigationResults.set(detective, `${target}님의 직업은 ${ROLE_LABELS[this.roles.get(target)!]}입니다.`);
    }
    const target = this.majorityTarget('mafiaVote');
    if (target === null) events.push({ text: '마피아의 목표가 동률이라 아무도 탈락하지 않았습니다.' });
    else if (target === protectedPlayer) events.push({ text: '누군가의 밤 공격이 막혔습니다.' });
    else this.eliminate(target, '밤사이', events);
    if (this.checkFinished(events)) return events;
    this.phase = 'day';
    this.actions = new Map();
    events.push({ text: '낮이 되었습니다. 생존자 모두 투표하세요.' });
    return events;
  }

  private resolveDay(): EngineEvent[] {
    const events: EngineEvent[] = [];
    const target = this.majorityTarget('vote');
    if (target === null) events.push({ text: '투표가 동률이라 아무도 탈락하지 않았습니다.' });
    else this.eliminate(target, '투표로', events);
    if (this.checkFinished(events)) return events;
    this.phase = 'night';
    this.day++;
    this.actions = new Map();
    events.push({ text: '밤이 되었습니다. 마피아와 특수직업자는 행동할 대상을 고르세요.' });
    return events;
  }

  private playerForAction(action: string): string | undefined {
    return [...this.actions.keys()].find((player) => this.roleAction(player) === action);
  }

  private targetForAction(action: string): string | undefined {
    const player = this.playerForAction(action);
    return player === undefined ? undefined : this.actions.get(player);
  }

  private majorityTarget(action: string): string | null {
    const totals = new Map<string, number>();
    for (const [player, target] of this.actions) {
      if (this.roleAction(player) === action) totals.set(target, (totals.get(target) ?? 0) + 1);
    }
    let max = 0;
    let targets: string[] = [];
    for (const [target, count] of totals) {
      if (count > max) { max = count; targets = [target]; }
      else if (count === max) targets.push(target);
    }
    return targets.length === 1 ? targets[0]! : null;
  }

  private eliminate(target: string, reason: string, events: EngineEvent[]): void {
    this.alive.delete(target);
    events.push({ text: `${target}님이 ${reason} 탈락했습니다. 역할: ${ROLE_LABELS[this.roles.get(target)!]}` });
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
    const action = this.roleAction(player);
    return {
      phase: this.finished ? 'result' : this.phase,
      yourActions: action === null || this.actions.has(player) ? [] : [action],
      yourRole: role,
      phaseLabel: this.phase === 'night' ? '밤' : '낮',
      alive: this.players.map((nickname) => ({ nickname, alive: this.alive.has(nickname), role: this.visibleRole(player, nickname) })),
      day: this.day,
      // 낮 투표를 마친 사람. 밤에는 비운다 — 밤에 행동을 마친 사람이 보이면 그가 마피아·특수직업이라는 게 드러난다.
      voted: this.phase === 'day' && !this.finished ? this.players.filter((p) => this.actions.has(p)) : [],
      hasActed: this.actions.has(player),
      investigationResult: this.investigationResults.get(player),
      chat: this.chatStatus(player),
    };
  }

  /**
   * viewer에게 보이는 target의 역할. 탈락자의 역할은 모두에게 공개되고, 마피아는 살아 있는 동료 마피아를
   * 안다. 그 밖에는 아무것도 보이지 않는다(undefined).
   */
  private visibleRole(viewer: string, target: string): Role | undefined {
    if (!this.alive.has(target)) return this.roles.get(target);
    if (this.roles.get(viewer) === 'mafia' && this.roles.get(target) === 'mafia') return 'mafia';
    return undefined;
  }

  /**
   * 정석 규칙: 탈락자는 낮·밤 모두 탈락자끼리만, 밤에는 생존 마피아끼리만, 낮에는 생존자 전원이
   * 대화한다. 탈락자의 말은 어떤 단계에서도 생존자에게 닿지 않는다 — 죽은 사람이 정체를 흘리는 걸 막는다.
   */
  chatRoute(sender: string): ChatRoute {
    if (!this.alive.has(sender)) {
      return { ok: true, channel: 'dead', to: this.players.filter((p) => !this.alive.has(p)) };
    }
    const alive = this.players.filter((p) => this.alive.has(p));
    if (this.phase === 'day') return { ok: true, channel: 'all', to: alive };
    if (this.roles.get(sender) === 'mafia') {
      return { ok: true, channel: 'mafia', to: alive.filter((p) => this.roles.get(p) === 'mafia') };
    }
    return { ok: false, reason: '밤에는 채팅할 수 없습니다.' };
  }

  private chatStatus(player: string): { canSend: boolean; channel: ChatChannel | null } {
    const route = this.chatRoute(player);
    return route.ok ? { canSend: true, channel: route.channel } : { canSend: false, channel: null };
  }

  /**
   * 밤에 아직 행동하지 않은 살아 있는 마피아의 조준만, 살아 있는 마피아끼리 공유한다. 낮 투표 커서는
   * 숨긴다(투표는 비밀이다) — 시민·특수직업·탈락자의 커서도 전달하지 않는다.
   */
  focusRoute(sender: string, target: unknown): FocusRoute {
    if (this.finished || this.phase !== 'night' || !this.alive.has(sender)) return null;
    if (this.roles.get(sender) !== 'mafia' || this.actions.has(sender)) return null;
    const to = this.players.filter((p) => this.alive.has(p) && this.roles.get(p) === 'mafia');
    if (target === null) return { to, target: null };
    const aim = focusField(target, 'target');
    if (typeof aim !== 'string' || aim === sender || !this.alive.has(aim)) return null;
    return { to, target: { target: aim } };
  }

  pendingPlayers(): string[] {
    return this.finished ? [] : this.players.filter((p) => this.roleAction(p) !== null && !this.actions.has(p));
  }

  defaultAction(player: string): EngineAction | null {
    const action = this.roleAction(player);
    const target = this.players.find((p) => p !== player && this.alive.has(p));
    return action !== null && target ? { name: action, arg: target } : null;
  }

  removePlayer(player: string): EngineEvent[] {
    if (!this.alive.delete(player)) return [];
    const events = [{ text: `${player}님이 게임을 떠나 탈락 처리되었습니다.` }];
    if (!this.checkFinished(events) && this.pendingPlayers().length === 0) {
      events.push(...(this.phase === 'night' ? this.resolveNight() : this.resolveDay()));
    }
    return events;
  }

  isFinished(): boolean { return this.finished; }

  result(): { ranking: { nickname: string; detail: string }[] } | null {
    if (!this.finished || this.winner === null) return null;
    return { ranking: this.players.map((nickname) => ({ nickname, detail: `${ROLE_LABELS[this.roles.get(nickname)!]}${this.roles.get(nickname) === this.winner ? ' · 승리' : ''}` })) };
  }
}

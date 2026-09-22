import { describe, expect, it } from 'vitest';
import { isValidMafiaCount, MafiaEngine } from '../src/games/mafia.js';
import { mulberry32 } from '../src/rng.js';

type Role = 'mafia' | 'citizen' | 'doctor' | 'police' | 'detective';

function playerWithRole(game: MafiaEngine, players: string[], role: Role): string {
  const player = players.find((p) => (game.getViewFor(p) as { yourRole: Role }).yourRole === role);
  if (player === undefined) throw new Error(`missing ${role}`);
  return player;
}

describe('MafiaEngine', () => {
  it('마피아 수는 참가자의 절반 미만이어야 한다', () => {
    expect(isValidMafiaCount(4, 1)).toBe(true);
    expect(isValidMafiaCount(4, 2)).toBe(false);
    expect(isValidMafiaCount(5, 2)).toBe(true);
    expect(isValidMafiaCount(6, 3)).toBe(false);
  });

  it('특수직업은 각 1명만 배정하고, 선택한 직업이 많아도 시민 자리를 남긴다', () => {
    const game = new MafiaEngine({ mafiaCount: 1, specialRoles: ['doctor', 'police', 'detective'] });
    const players = ['a', 'b', 'c', 'd'];
    game.start(players, 'a', mulberry32(1));

    const roles = players.map((p) => (game.getViewFor(p) as { yourRole: Role }).yourRole);
    expect(roles.filter((role) => role === 'mafia')).toHaveLength(1);
    expect(roles.filter((role) => role === 'citizen')).toHaveLength(1);
    expect(roles.filter((role) => ['doctor', 'police', 'detective'].includes(role))).toHaveLength(2);
  });

  it('의사의 보호 대상은 밤 공격에서 살아남는다', () => {
    const game = new MafiaEngine({ mafiaCount: 1, specialRoles: ['doctor'] });
    const players = ['a', 'b', 'c', 'd', 'e'];
    game.start(players, 'a', mulberry32(2));
    const mafia = playerWithRole(game, players, 'mafia');
    const doctor = playerWithRole(game, players, 'doctor');
    const target = players.find((p) => p !== mafia && p !== doctor)!;

    game.handleAction(mafia, { name: 'mafiaVote', arg: target });
    const events = game.handleAction(doctor, { name: 'protect', arg: target });

    expect(events.map((event) => event.text).join(' ')).toContain('막혔습니다');
    expect((game.getViewFor(target) as { alive: { nickname: string; alive: boolean }[] }).alive.find((p) => p.nickname === target)?.alive).toBe(true);
  });

  it('경찰은 마피아 여부를, 탐정은 정확한 직업을 개인적으로 확인한다', () => {
    const game = new MafiaEngine({ mafiaCount: 1, specialRoles: ['doctor', 'police', 'detective'] });
    const players = ['a', 'b', 'c', 'd', 'e'];
    game.start(players, 'a', mulberry32(3));
    const mafia = playerWithRole(game, players, 'mafia');
    const doctor = playerWithRole(game, players, 'doctor');
    const police = playerWithRole(game, players, 'police');
    const detective = playerWithRole(game, players, 'detective');

    game.handleAction(mafia, { name: 'mafiaVote', arg: doctor });
    game.handleAction(doctor, { name: 'protect', arg: doctor });
    game.handleAction(police, { name: 'investigateMafia', arg: mafia });
    game.handleAction(detective, { name: 'investigateRole', arg: police });

    expect((game.getViewFor(police) as { investigationResult?: string }).investigationResult).toContain('마피아입니다');
    expect((game.getViewFor(detective) as { investigationResult?: string }).investigationResult).toContain('경찰');
  });

  describe('chatRoute', () => {
    /** 마피아 1명·시민 4명(특수직업 없음) 게임을 시작한다. */
    function startPlain() {
      const game = new MafiaEngine({ mafiaCount: 1, specialRoles: [] });
      const players = ['a', 'b', 'c', 'd', 'e'];
      game.start(players, 'a', mulberry32(5));
      const mafia = playerWithRole(game, players, 'mafia');
      const citizens = players.filter((p) => p !== mafia);
      return { game, players, mafia, citizens };
    }

    it('밤에는 마피아끼리만 비밀 채팅하고, 다른 생존자는 채팅할 수 없다', () => {
      const game = new MafiaEngine({ mafiaCount: 2, specialRoles: [] });
      const players = ['a', 'b', 'c', 'd', 'e'];
      game.start(players, 'a', mulberry32(6));
      const mafia = players.filter((p) => (game.getViewFor(p) as { yourRole: Role }).yourRole === 'mafia');
      const citizen = players.find((p) => !mafia.includes(p))!;

      expect(game.chatRoute(mafia[0]!)).toEqual({ ok: true, channel: 'mafia', to: mafia });
      expect(game.chatRoute(citizen)).toEqual({ ok: false, reason: '밤에는 채팅할 수 없습니다.' });
      expect((game.getViewFor(mafia[0]!) as { chat: unknown }).chat).toEqual({ canSend: true, channel: 'mafia' });
      expect((game.getViewFor(citizen) as { chat: unknown }).chat).toEqual({ canSend: false, channel: null });
    });

    it('낮에는 생존자 전원 채널이다', () => {
      const { game, players, mafia, citizens } = startPlain();
      game.handleAction(mafia, { name: 'mafiaVote', arg: citizens[0]! });
      const alive = players.filter((p) => p !== citizens[0]);

      expect(game.chatRoute(citizens[1]!)).toEqual({ ok: true, channel: 'all', to: alive });
      expect((game.getViewFor(citizens[1]!) as { chat: unknown }).chat).toEqual({ canSend: true, channel: 'all' });
    });

    it('탈락자는 낮·밤 모두 탈락자끼리만 대화하고 생존자에게는 전달되지 않는다', () => {
      const { game, mafia, citizens } = startPlain();
      const dead = citizens[0]!;
      game.handleAction(mafia, { name: 'mafiaVote', arg: dead });

      expect(game.chatRoute(dead)).toEqual({ ok: true, channel: 'dead', to: [dead] });
      expect((game.getViewFor(dead) as { chat: unknown }).chat).toEqual({ canSend: true, channel: 'dead' });

      // 낮 투표로 한 명 더 탈락시켜 밤으로 넘긴다.
      const alive = [mafia, ...citizens.slice(1)];
      const voted = citizens[1]!;
      for (const p of alive) game.handleAction(p, { name: 'vote', arg: p === voted ? mafia : voted });
      expect(game.chatRoute(dead)).toEqual({ ok: true, channel: 'dead', to: [dead, voted] });
    });
  });
});

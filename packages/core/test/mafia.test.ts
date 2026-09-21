import { describe, expect, it } from 'vitest';
import { MafiaEngine } from '../src/games/mafia.js';
import { mulberry32 } from '../src/rng.js';

describe('MafiaEngine', () => {
  it('assigns one private mafia role and resolves a night vote', () => {
    const game = new MafiaEngine();
    const players = ['a', 'b', 'c', 'd'];
    game.start(players, 'a', mulberry32(1));

    const mafia = players.find((p) => (game.getViewFor(p) as { yourRole: string }).yourRole === 'mafia');
    expect(mafia).toBeDefined();
    const citizen = players.find((p) => p !== mafia)!;
    expect((game.getViewFor(citizen) as { yourRole: string }).yourRole).toBe('citizen');

    const events = game.handleAction(mafia!, { name: 'vote', arg: citizen });
    expect(events.at(-1)?.text).toContain('낮이 되었습니다');
    const view = game.getViewFor(citizen) as { phase: string; alive: { nickname: string; alive: boolean }[] };
    expect(view.phase).toBe('day');
    expect(view.alive.find((p) => p.nickname === citizen)?.alive).toBe(false);
  });

  it('ends with a citizen victory when the mafia is voted out', () => {
    const game = new MafiaEngine();
    const players = ['a', 'b', 'c', 'd'];
    game.start(players, 'a', mulberry32(1));
    const mafia = players.find((p) => (game.getViewFor(p) as { yourRole: string }).yourRole === 'mafia')!;
    const nightTarget = players.find((p) => p !== mafia)!;
    game.handleAction(mafia, { name: 'vote', arg: nightTarget });

    const aliveCitizens = players.filter((p) => p !== nightTarget && p !== mafia);
    for (const p of aliveCitizens) game.handleAction(p, { name: 'vote', arg: mafia });
    game.handleAction(mafia, { name: 'vote', arg: aliveCitizens[0] });
    expect(game.isFinished()).toBe(true);
    expect(game.result()?.ranking.find((p) => p.nickname === mafia)?.detail).toContain('마피아');
  });
});

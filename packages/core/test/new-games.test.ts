import { describe, expect, it } from 'vitest';
import { DavinciEngine } from '../src/games/davinci.js';
import { LiarEngine } from '../src/games/liar.js';
import { IndianPokerEngine } from '../src/games/indianPoker.js';
import { mulberry32 } from '../src/rng.js';

describe('new party games', () => {
  it('다빈치 코드는 정답 타일을 공개하고 오답이면 차례가 넘어간다', () => {
    const game = new DavinciEngine();
    game.start(['a', 'b'], 'a', mulberry32(1));
    const board = game.getViewFor('b') as { boards: { nickname: string; tiles: { value: number | null }[] }[] };
    const target = board.boards.find((item) => item.nickname === 'b')!;
    const value = target.tiles[0]!.value!;
    expect(game.handleAction('a', { name: 'guess', arg: { player: 'b', index: 0, value } })[0]?.text).toContain('정답');
    expect(game.handleAction('a', { name: 'guess', arg: { player: 'b', index: 1, value: 99 } })).toEqual([]);
    const secondValue = target.tiles[1]!.value!;
    expect(game.handleAction('a', { name: 'guess', arg: { player: 'b', index: 1, value: (secondValue + 1) % 12 } })[0]?.text).toContain('오답');
    expect((game.getViewFor('b') as { yourActions: string[] }).yourActions).toContain('guess');
  });

  it('라이어 게임은 모든 투표가 끝나면 결과를 공개한다', () => {
    const game = new LiarEngine();
    const players = ['a', 'b', 'c'];
    game.start(players, 'a', mulberry32(2));
    const liar = players.find((player) => (game.getViewFor(player) as { yourWord: string }).yourWord.startsWith('라이어'))!;
    for (const player of players) game.handleAction(player, { name: 'vote', arg: player === liar ? players.find((item) => item !== liar)! : liar });
    expect(game.isFinished()).toBe(true);
    expect(game.result()?.ranking.find((item) => item.nickname === liar)?.detail).toContain('라이어');
  });

  it('라이어 게임은 미투표자가 떠나 남은 전원의 투표가 끝난 상태가 되면 즉시 종료한다', () => {
    const game = new LiarEngine();
    const players = ['a', 'b', 'c'];
    game.start(players, 'a', mulberry32(7));
    const leaving = players.find((player) => !(game.getViewFor(player) as { yourWord: string }).yourWord.startsWith('라이어'))!;
    const remaining = players.filter((player) => player !== leaving);
    for (const player of remaining) game.handleAction(player, { name: 'vote', arg: remaining.find((target) => target !== player)! });
    game.removePlayer(leaving);
    expect(game.isFinished()).toBe(true);
    expect(game.pendingPlayers()).toEqual([]);
  });

  it('인디언 포커는 한 덱을 모두 소진할 때까지 이전 카드를 다시 내지 않는다', () => {
    const game = new IndianPokerEngine();
    game.start(['a', 'b'], 'a', mulberry32(3));
    const seen = new Set<string>();
    for (let round = 0; round < 26; round++) {
      const aView = game.getViewFor('a') as { yourCard: string; others: { card: string }[] };
      expect(aView.yourCard).toBe('?');
      expect(seen.has(aView.others[0]?.card ?? '')).toBe(false);
      seen.add(aView.others[0]!.card);
      const currentRound = (aView as unknown as { round: number }).round;
      while (!game.isFinished() && (game.getViewFor('a') as { round: number }).round === currentRound) {
        game.handleAction(game.pendingPlayers()[0]!, { name: 'call' });
      }
    }
    expect(seen).toHaveLength(26);
    expect(game.isFinished()).toBe(true);
  });

  it('인디언 포커에서 현재 차례가 나가도 다음 참가자가 계속 진행한다', () => {
    const game = new IndianPokerEngine();
    game.start(['a', 'b', 'c'], 'a', mulberry32(4));
    game.removePlayer('a');
    expect((game.getViewFor('b') as { yourActions: string[] }).yourActions).toContain('call');
    game.handleAction('b', { name: 'call' });
    game.handleAction('c', { name: 'call' });
    expect(game.isFinished()).toBe(false);
  });

  it('인디언 포커에서 현재 차례보다 앞선 참가자가 나가도 차례가 유지된다', () => {
    const game = new IndianPokerEngine();
    game.start(['a', 'b', 'c'], 'a', mulberry32(4));
    game.handleAction('a', { name: 'call' });
    game.handleAction('b', { name: 'call' });
    game.removePlayer('a');
    expect(game.pendingPlayers()).toEqual(['c']);
    expect((game.getViewFor('c') as { yourActions: string[] }).yourActions).toContain('call');
  });

  it('인디언 포커는 콜에 추가 칩을 걸고 폴드에는 참가비만 부과한다', () => {
    const game = new IndianPokerEngine();
    game.start(['a', 'b'], 'a', mulberry32(9));
    const before = game.getViewFor('a') as { pot: number; chips: { nickname: string; chips: number }[] };
    expect(before.pot).toBe(2);
    expect(before.chips.find((entry) => entry.nickname === 'a')?.chips).toBe(51);
    game.handleAction('a', { name: 'call' });
    const afterCall = game.getViewFor('a') as { pot: number; chips: { nickname: string; chips: number }[] };
    expect(afterCall.pot).toBe(3);
    expect(afterCall.chips.find((entry) => entry.nickname === 'a')?.chips).toBe(50);
    game.handleAction('b', { name: 'fold' });
    const nextRound = game.getViewFor('a') as { round: number };
    expect(nextRound.round).toBe(2);
  });

  it('다빈치 코드 다인전은 한 명의 타일이 모두 공개돼도 최후의 생존자가 정해질 때까지 계속된다', () => {
    const game = new DavinciEngine();
    game.start(['a', 'b', 'c'], 'a', mulberry32(11));
    const bBoard = (game.getViewFor('b') as { boards: { nickname: string; tiles: { value: number | null }[] }[] }).boards.find((board) => board.nickname === 'b')!;
    bBoard.tiles.forEach((tile, index) => game.handleAction('a', { name: 'guess', arg: { player: 'b', index, value: tile.value } }));
    expect(game.isFinished()).toBe(false);
    const view = game.getViewFor('a') as { boards: { nickname: string; eliminated: boolean }[] };
    expect(view.boards.find((board) => board.nickname === 'b')?.eliminated).toBe(true);
  });
});

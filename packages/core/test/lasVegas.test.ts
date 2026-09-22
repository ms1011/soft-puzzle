import { describe, it, expect } from 'vitest';
import {
  LasVegasEngine,
  payout,
  formatMoney,
  makeMoneyDeck,
  CASINO_MIN_TOTAL,
} from '../src/games/lasVegas.js';
import { mulberry32 } from '../src/rng.js';

interface V {
  phase: string;
  yourActions: string[];
  round: number;
  totalRounds: number;
  turnPlayer: string | null;
  dice: number[];
  casinos: { number: number; bills: number[]; dice: { nickname: string; count: number }[] }[];
  players: { nickname: string; diceLeft: number; money: number; bills: number; isTurn: boolean }[];
  lastPayout: { casino: number; awards: { nickname: string; bill: number }[] }[] | null;
}

function view(e: LasVegasEngine, p = ''): V {
  return e.getViewFor(p) as unknown as V;
}

function newGame(players: string[], seed = 1): LasVegasEngine {
  const e = new LasVegasEngine();
  e.start(players, players[0]!, mulberry32(seed));
  return e;
}

/** 현재 차례인 사람이 defaultAction대로 한 번 둔다. */
function stepDefault(e: LasVegasEngine): void {
  const p = e.pendingPlayers()[0]!;
  const a = e.defaultAction(p)!;
  expect(e.handleAction(p, a).length).toBeGreaterThan(0);
}

describe('payout', () => {
  it('개수 내림차순으로 높은 지폐부터 한 장씩 준다', () => {
    expect(
      payout([90, 20], [
        { nickname: 'A', count: 2 },
        { nickname: 'B', count: 5 },
        { nickname: 'C', count: 1 },
      ]),
    ).toEqual([
      { nickname: 'B', bill: 90 },
      { nickname: 'A', bill: 20 },
    ]);
  });

  it('같은 개수를 가진 사람들은 전원 무효가 되고 다음 사람이 1등 지폐를 받는다', () => {
    expect(
      payout([60, 30, 10], [
        { nickname: 'A', count: 4 },
        { nickname: 'B', count: 4 },
        { nickname: 'C', count: 2 },
        { nickname: 'D', count: 1 },
      ]),
    ).toEqual([
      { nickname: 'C', bill: 60 },
      { nickname: 'D', bill: 30 },
    ]);
  });

  it('모두 동점이면 아무도 못 받고, 0개인 사람은 무시한다', () => {
    expect(payout([50], [{ nickname: 'A', count: 3 }, { nickname: 'B', count: 3 }])).toEqual([]);
    expect(payout([50], [{ nickname: 'A', count: 0 }, { nickname: 'B', count: 1 }])).toEqual([{ nickname: 'B', bill: 50 }]);
  });

  it('formatMoney는 $와 천 단위 구분자를 쓴다', () => {
    expect(formatMoney(60)).toBe('$60,000');
    expect(formatMoney(230)).toBe('$230,000');
    expect(formatMoney(1250)).toBe('$1,250,000');
    expect(formatMoney(0)).toBe('$0');
  });

  it('지폐 덱은 54장이다', () => {
    expect(makeMoneyDeck()).toHaveLength(54);
  });
});

describe('LasVegasEngine', () => {
  it('시작하면 카지노 6곳이 $50,000 이상·내림차순으로 깔리고 첫 사람의 주사위 8개가 굴려져 있다', () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const e = newGame(['철수', '영희', '민수'], seed);
      const v = view(e, '철수');
      expect(v.round).toBe(1);
      expect(v.totalRounds).toBe(4);
      expect(v.casinos).toHaveLength(6);
      for (const c of v.casinos) {
        expect(c.bills.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(CASINO_MIN_TOTAL);
        expect(c.bills).toEqual([...c.bills].sort((a, b) => b - a));
        expect(c.dice).toEqual([]);
      }
      expect(v.turnPlayer).toBe('철수');
      expect(v.dice).toHaveLength(8);
      expect(v.yourActions).toEqual(['place']);
      expect(view(e, '영희').yourActions).toEqual([]);
      expect(e.pendingPlayers()).toEqual(['철수']);
    }
  });

  it('place는 그 눈의 주사위를 전부 같은 번호 카지노에 놓고, 굴리지 않은 눈·잘못된 인자는 거부한다', () => {
    const e = newGame(['철수', '영희'], 7);
    const v = view(e, '철수');
    const missing = [1, 2, 3, 4, 5, 6].find((f) => !v.dice.includes(f));
    if (missing !== undefined) expect(e.handleAction('철수', { name: 'place', arg: missing })).toEqual([]);
    expect(e.handleAction('철수', { name: 'place', arg: 0 })).toEqual([]);
    expect(e.handleAction('철수', { name: 'place', arg: '3' })).toEqual([]);
    expect(e.handleAction('철수', { name: 'roll' })).toEqual([]);
    // 차례가 아닌 사람은 못 둔다.
    expect(e.handleAction('영희', { name: 'place', arg: v.dice[0] })).toEqual([]);
    expect(view(e, '철수')).toEqual(v); // 무효 액션은 상태 불변

    const face = v.dice[0]!;
    const n = v.dice.filter((d) => d === face).length;
    const events = e.handleAction('철수', { name: 'place', arg: face });
    expect(events[0]!.text).toContain(`${face}번 카지노`);
    const after = view(e, '영희');
    expect(after.casinos[face - 1]!.dice).toEqual([{ nickname: '철수', count: n }]);
    expect(after.players.find((p) => p.nickname === '철수')!.diceLeft).toBe(8 - n);
    expect(after.turnPlayer).toBe('영희');
    expect(after.dice).toHaveLength(8);
    expect(after.yourActions).toEqual(['place']);
  });

  it('주사위를 다 쓴 사람은 건너뛴다', () => {
    const e = newGame(['A', 'B', 'C'], 5);
    // 라운드 1 동안 차례 순서를 기록한다. 주사위가 0인 사람이 차례를 받으면 안 된다.
    let guard = 0;
    while (view(e).round === 1 && !e.isFinished() && guard++ < 100) {
      const v = view(e);
      const turn = v.players.find((p) => p.isTurn)!;
      expect(turn.diceLeft).toBeGreaterThan(0);
      expect(v.dice).toHaveLength(turn.diceLeft);
      stepDefault(e);
    }
    expect(view(e).round).toBe(2);
  });

  it('라운드 끝 정산은 payout 규칙대로 돈을 준다(동점 무효 포함)', () => {
    const e = newGame(['A', 'B', 'C'], 11);
    let guard = 0;
    // 라운드 1의 마지막 한 수 직전까지 진행한다.
    while (guard++ < 100) {
      const v = view(e);
      const totalLeft = v.players.reduce((s, p) => s + p.diceLeft, 0);
      const turn = v.players.find((p) => p.isTurn)!;
      if (turn.diceLeft === totalLeft && new Set(v.dice).size === 1) break; // 한 수로 끝나는 상황
      if (v.round !== 1) throw new Error('라운드 1이 예상보다 먼저 끝났다');
      stepDefault(e);
    }
    const before = view(e);
    const p = before.turnPlayer!;
    const face = before.dice[0]!;
    // 마지막 수를 반영한 카지노 상태로 기대 정산을 계산한다.
    const expected = new Map(before.players.map((pl) => [pl.nickname, pl.money]));
    for (const c of before.casinos) {
      const counts = c.dice.map((d) => ({ ...d }));
      if (c.number === face) {
        const mine = counts.find((d) => d.nickname === p);
        if (mine) mine.count += before.dice.length;
        else counts.push({ nickname: p, count: before.dice.length });
      }
      for (const a of payout(c.bills, counts)) expected.set(a.nickname, expected.get(a.nickname)! + a.bill);
    }
    e.handleAction(p, { name: 'place', arg: face });
    const after = view(e);
    expect(after.round).toBe(2);
    for (const pl of after.players) expect(pl.money).toBe(expected.get(pl.nickname));
    expect(after.lastPayout).toHaveLength(6);
    // 라운드 2는 두 번째 사람이 시작하고, 모두 주사위 8개를 다시 받는다.
    expect(after.turnPlayer).toBe('B');
    for (const pl of after.players) expect(pl.diceLeft).toBe(8);
    for (const c of after.casinos) expect(c.dice).toEqual([]);
  });

  it('defaultAction만으로 4라운드를 마치면 종료되고 돈 내림차순으로 순위가 매겨진다', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const players = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, 2 + (seed % 5));
      const e = newGame(players, seed);
      expect(e.result()).toBeNull();
      let guard = 0;
      while (!e.isFinished() && guard++ < 1000) {
        expect(e.pendingPlayers()).toHaveLength(1);
        stepDefault(e);
      }
      expect(e.isFinished()).toBe(true);
      expect(guard).toBeLessThanOrEqual(4 * 8 * players.length);
      expect(e.pendingPlayers()).toEqual([]);
      expect(e.defaultAction('A')).toBeNull();
      const v = view(e, 'A');
      expect(v.round).toBe(4);
      expect(v.yourActions).toEqual([]);
      const ranking = e.result()!.ranking;
      expect(ranking).toHaveLength(players.length);
      const moneyOf = (n: string): number => v.players.find((p) => p.nickname === n)!.money;
      for (let i = 1; i < ranking.length; i++) {
        expect(moneyOf(ranking[i - 1]!.nickname)).toBeGreaterThanOrEqual(moneyOf(ranking[i]!.nickname));
      }
      expect(ranking[0]!.detail).toBe(`${formatMoney(moneyOf(ranking[0]!.nickname))} (지폐 ${v.players.find((p) => p.nickname === ranking[0]!.nickname)!.bills}장)`);
    }
  });

  it('defaultAction은 가장 많이 나온 눈(동수면 큰 눈)을 고르는 순수 조회다', () => {
    const e = newGame(['A', 'B'], 3);
    const v = view(e, 'A');
    const a1 = e.defaultAction('A');
    const a2 = e.defaultAction('A');
    expect(a1).toEqual(a2);
    expect(view(e, 'A')).toEqual(v);
    const counts = [1, 2, 3, 4, 5, 6].map((f) => v.dice.filter((d) => d === f).length);
    const max = Math.max(...counts);
    expect(a1).toEqual({ name: 'place', arg: counts.lastIndexOf(max) + 1 });
    expect(e.defaultAction('B')).toBeNull();
  });

  it('차례인 사람이 떠나면 그 주사위를 카지노에서 빼고 다음 사람 차례가 된다', () => {
    const e = newGame(['A', 'B', 'C'], 9);
    stepDefault(e); // A가 한 번 둠 → B 차례
    expect(view(e).turnPlayer).toBe('B');
    stepDefault(e); // B 둠 → C 차례
    stepDefault(e); // C 둠 → A 차례
    expect(view(e).turnPlayer).toBe('A');
    const events = e.removePlayer('A');
    expect(events[0]!.text).toContain('떠났');
    const v = view(e, 'B');
    expect(v.turnPlayer).toBe('B');
    expect(v.players.map((p) => p.nickname)).toEqual(['B', 'C']);
    for (const c of v.casinos) expect(c.dice.some((d) => d.nickname === 'A')).toBe(false);
    expect(v.dice).toHaveLength(v.players[0]!.diceLeft);
    expect(e.pendingPlayers()).toEqual(['B']);
    expect(e.removePlayer('A')).toEqual([]);

    // 차례가 아닌 사람이 떠나면 차례는 그대로다.
    const e2 = newGame(['A', 'B', 'C'], 9);
    e2.removePlayer('C');
    expect(e2.pendingPlayers()).toEqual(['A']);

    // 2명 미만이 되면 끝난다.
    e.removePlayer('C');
    expect(e.isFinished()).toBe(true);
    expect(e.pendingPlayers()).toEqual([]);
    expect(e.result()!.ranking.map((r) => r.nickname)).toEqual(['B']);
  });

  it('이탈이 섞여도 pendingPlayers는 끝날 때까지 비지 않는다', () => {
    const e = newGame(['A', 'B', 'C', 'D'], 21);
    let guard = 0;
    let removed = false;
    while (!e.isFinished() && guard++ < 1000) {
      expect(e.pendingPlayers()).toHaveLength(1);
      if (!removed && view(e).round === 2) {
        e.removePlayer(e.pendingPlayers()[0]!);
        removed = true;
        continue;
      }
      stepDefault(e);
    }
    expect(e.isFinished()).toBe(true);
    expect(e.result()!.ranking).toHaveLength(3);
  });
});

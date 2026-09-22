import { describe, expect, it } from 'vitest';
import { OneCardEngine } from '../src/games/onecard.js';
import { DavinciEngine } from '../src/games/davinci.js';
import { YachtEngine } from '../src/games/yacht.js';
import { MafiaEngine } from '../src/games/mafia.js';
import { YutEngine } from '../src/games/yut.js';
import { LasVegasEngine } from '../src/games/lasVegas.js';
import { mulberry32 } from '../src/rng.js';

describe('OneCardEngine.focusRoute', () => {
  function started() {
    const e = new OneCardEngine();
    e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
    return e; // 첫 차례는 철수, 손패 7장
  }

  it('차례인 사람의 유효한 index는 정리된 { index }로 전원에게 간다', () => {
    expect(started().focusRoute('철수', { index: 3, extra: 'x' })).toEqual({ to: 'all', target: { index: 3 } });
  });

  it('null은 "고민 중 아님"으로 전원에게 간다', () => {
    expect(started().focusRoute('철수', null)).toEqual({ to: 'all', target: null });
  });

  it('차례가 아니거나, 범위 밖이거나, 정수가 아니면 null', () => {
    const e = started();
    expect(e.focusRoute('영희', { index: 0 })).toBeNull();
    expect(e.focusRoute('철수', { index: 7 })).toBeNull();
    expect(e.focusRoute('철수', { index: -1 })).toBeNull();
    expect(e.focusRoute('철수', { index: 1.5 })).toBeNull();
    expect(e.focusRoute('철수', 'hello')).toBeNull();
  });
});

describe('DavinciEngine.focusRoute', () => {
  function started() {
    const e = new DavinciEngine();
    e.start(['a', 'b'], 'a', mulberry32(1));
    return e; // a의 차례
  }

  it('상대의 숨김 타일은 { player, index }로 전원에게 가고, 숫자는 담기지 않는다', () => {
    expect(started().focusRoute('a', { player: 'b', index: 2, value: 5 })).toEqual({ to: 'all', target: { player: 'b', index: 2 } });
  });

  it('자기 타일·공개된 타일·없는 타일·차례 아님은 null', () => {
    const e = started();
    expect(e.focusRoute('a', { player: 'a', index: 0 })).toBeNull();
    expect(e.focusRoute('a', { player: 'b', index: 9 })).toBeNull();
    expect(e.focusRoute('b', { player: 'a', index: 0 })).toBeNull();
    const value = (e.getViewFor('b') as { boards: { nickname: string; tiles: { value: number | null }[] }[] })
      .boards.find((board) => board.nickname === 'b')!.tiles[0]!.value!;
    e.handleAction('a', { name: 'guess', arg: { player: 'b', index: 0, value } }); // 정답 → 공개, a가 계속
    expect(e.focusRoute('a', { player: 'b', index: 0 })).toBeNull();
  });
});

describe('YachtEngine.focusRoute', () => {
  it('차례인 사람의 빈 칸은 { category }로 전원에게, 기록한 칸·모르는 칸·차례 아님은 null', () => {
    const e = new YachtEngine();
    e.start(['a', 'b'], 'a', mulberry32(1));
    expect(e.focusRoute('a', { category: 'chance' })).toEqual({ to: 'all', target: { category: 'chance' } });
    expect(e.focusRoute('a', { category: 'nope' })).toBeNull();
    expect(e.focusRoute('b', { category: 'chance' })).toBeNull();
    e.handleAction('a', { name: 'score', arg: 'chance' });
    e.handleAction('b', { name: 'score', arg: 'ones' });
    expect(e.focusRoute('a', { category: 'chance' })).toBeNull();
    expect(e.focusRoute('a', { category: 'ones' })).toEqual({ to: 'all', target: { category: 'ones' } });
  });
});

describe('MafiaEngine.focusRoute', () => {
  function started() {
    const e = new MafiaEngine({ mafiaCount: 2, specialRoles: ['doctor'] });
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    e.start(players, 'p1', mulberry32(3));
    const roleOf = (p: string) => (e.getViewFor(p) as { yourRole: string }).yourRole;
    const mafia = players.filter((p) => roleOf(p) === 'mafia');
    const doctor = players.find((p) => roleOf(p) === 'doctor')!;
    const citizens = players.filter((p) => roleOf(p) === 'citizen');
    return { e, mafia, doctor, citizens };
  }

  it('밤에 마피아의 조준은 살아 있는 마피아에게만 간다', () => {
    const { e, mafia, citizens } = started();
    const route = e.focusRoute(mafia[0]!, { target: citizens[0]!, junk: 1 });
    expect(route).not.toBeNull();
    expect([...(route!.to as string[])].sort()).toEqual([...mafia].sort());
    expect(route!.target).toEqual({ target: citizens[0] });
  });

  it('시민·의사, 자기 자신 조준, 이미 행동한 마피아는 null', () => {
    const { e, mafia, doctor, citizens } = started();
    expect(e.focusRoute(citizens[0]!, { target: mafia[0]! })).toBeNull();
    expect(e.focusRoute(doctor, { target: mafia[0]! })).toBeNull();
    expect(e.focusRoute(mafia[0]!, { target: mafia[0]! })).toBeNull();
    e.handleAction(mafia[0]!, { name: 'mafiaVote', arg: citizens[0]! });
    expect(e.focusRoute(mafia[0]!, { target: citizens[1]! })).toBeNull();
  });

  it('낮에는 누구의 조준도 전달되지 않는다', () => {
    const { e, mafia, doctor, citizens } = started();
    for (const m of mafia) e.handleAction(m, { name: 'mafiaVote', arg: citizens[0]! });
    e.handleAction(doctor, { name: 'protect', arg: citizens[0]! }); // 막혀서 아무도 안 죽고 낮이 된다
    expect((e.getViewFor(mafia[0]!) as { phase: string }).phase).toBe('day');
    expect(e.focusRoute(mafia[0]!, { target: citizens[1]! })).toBeNull();
    expect(e.focusRoute(citizens[1]!, { target: mafia[0]! })).toBeNull();
  });
});

describe('YutEngine.focusRoute', () => {
  /** 걸만 나오는 rng로 시작해 a가 던진 뒤 이동 단계로 보낸다. */
  function moving() {
    const e = new YutEngine();
    // 윷가락 값: 0.1 = 배, 0.9 = 등. 걸 = 배 3개(0번 가락 포함) + 등 1개.
    const seq = [0.1, 0.1, 0.1, 0.9];
    let i = 0;
    e.start(['a', 'b'], 'a', () => seq[i++ % seq.length]!);
    e.handleAction('a', { name: 'throw' });
    return e;
  }

  it('합법 수를 고르는 중이면 도착 칸·경로까지 정리해 전원에게 보낸다', () => {
    expect(moving().focusRoute('a', { throwIndex: 0, piece: 0, junk: 1 })).toEqual({
      to: 'all',
      target: { throwIndex: 0, piece: 0, to: 3, path: [1, 2, 3] },
    });
  });

  it('합법 수가 아니거나, 던지는 단계거나, 차례가 아니면 null', () => {
    const e = moving();
    expect(e.focusRoute('a', { throwIndex: 5, piece: 0 })).toBeNull();
    expect(e.focusRoute('b', { throwIndex: 0, piece: 0 })).toBeNull();
    const fresh = new YutEngine();
    fresh.start(['a', 'b'], 'a', () => 0.1);
    expect(fresh.focusRoute('a', { throwIndex: 0, piece: 0 })).toBeNull();
  });
});

describe('LasVegasEngine.focusRoute', () => {
  function started() {
    const e = new LasVegasEngine();
    e.start(['a', 'b'], 'a', () => 0.99); // 모든 주사위가 6
    return e;
  }

  it('굴린 눈 중 고르는 눈을 { face }로 전원에게 보낸다', () => {
    expect(started().focusRoute('a', { face: 6, junk: true })).toEqual({ to: 'all', target: { face: 6 } });
  });

  it('굴리지 않은 눈·차례 아님은 null', () => {
    const e = started();
    expect(e.focusRoute('a', { face: 1 })).toBeNull();
    expect(e.focusRoute('b', { face: 6 })).toBeNull();
  });
});

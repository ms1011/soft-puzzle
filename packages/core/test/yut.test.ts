import { describe, it, expect } from 'vitest';
import { YutEngine, throwSticks, type YutThrowName } from '../src/games/yut.js';
import { mulberry32, type Rng } from '../src/rng.js';

/** 윷가락 4개 값(0.1 = 배(평평한 면), 0.9 = 등). 0번 가락이 빽도 표시 가락이다. */
const STICKS: Record<YutThrowName, number[]> = {
  빽도: [0.1, 0.9, 0.9, 0.9],
  도: [0.9, 0.1, 0.9, 0.9],
  개: [0.1, 0.1, 0.9, 0.9],
  걸: [0.1, 0.1, 0.1, 0.9],
  윷: [0.1, 0.1, 0.1, 0.1],
  모: [0.9, 0.9, 0.9, 0.9],
};

/** 지정한 결과 순서대로 나오는 결정적 rng. 다 쓰면 mulberry32로 이어간다. */
function scripted(...names: YutThrowName[]): Rng {
  const seq = names.flatMap((n) => STICKS[n]);
  const tail = mulberry32(99);
  let i = 0;
  return () => (i < seq.length ? seq[i++]! : tail());
}

interface PieceView {
  state: 'home' | 'board' | 'done';
  station?: number;
}
interface MoveView {
  throwIndex: number;
  piece: number;
  to: number | 'done';
  stack: number;
  capture: number;
}
interface YutView {
  phase: 'throw' | 'move';
  yourActions: string[];
  turnPlayer: string | null;
  throws: { name: string; steps: number }[];
  throwsLeft: number;
  players: { nickname: string; marker: string; pieces: PieceView[]; finished: number; home: number; isTurn: boolean }[];
  moves: MoveView[];
}

function view(e: YutEngine, p: string): YutView {
  return e.getViewFor(p) as unknown as YutView;
}

function pieces(e: YutEngine, p: string): PieceView[] {
  return view(e, p).players.find((x) => x.nickname === p)!.pieces;
}

/**
 * 테스트용 상태 주입 — 특정 칸에 말을 두고, 현재 차례의 쌓인 결과(pending)를 직접 정한다.
 * trail을 주지 않으면 그 칸만 기록된다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function place(e: YutEngine, p: string, idx: number, station: number | 'done', trail?: number[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (e as any).pieces.get(p)[idx];
  if (station === 'done') {
    m.where = 'done';
    m.trail = [];
    return;
  }
  m.where = 'board';
  m.station = station;
  m.trail = trail ?? [station];
}
function setPending(e: YutEngine, ...names: YutThrowName[]): void {
  const steps: Record<YutThrowName, number> = { 빽도: -1, 도: 1, 개: 2, 걸: 3, 윷: 4, 모: 5 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const x = e as any;
  x.credits = 0;
  x.pending = names.map((name) => ({ name, steps: steps[name] }));
}

function destinations(e: YutEngine, p: string, piece: number): (number | 'done')[] {
  return view(e, p)
    .moves.filter((m) => m.piece === piece)
    .map((m) => m.to);
}

describe('throwSticks', () => {
  it.each(Object.entries(STICKS))('%s 조합을 올바른 결과로 바꾼다', (name, vals) => {
    let i = 0;
    const r = throwSticks(() => vals[i++]!);
    expect(r.name).toBe(name);
  });

  it('확률 분포가 빽도 1/16, 도 3/16, 개 6/16, 걸 4/16, 윷 1/16, 모 1/16에 가깝다', () => {
    const rng = mulberry32(7);
    const counts: Record<string, number> = {};
    const N = 32000;
    for (let i = 0; i < N; i++) {
      const n = throwSticks(rng).name;
      counts[n] = (counts[n] ?? 0) + 1;
    }
    const expected: Record<string, number> = { 빽도: 1, 도: 3, 개: 6, 걸: 4, 윷: 1, 모: 1 };
    for (const [n, k] of Object.entries(expected)) {
      expect(Math.abs(counts[n]! / N - k / 16)).toBeLessThan(0.015);
    }
  });
});

describe('YutEngine', () => {
  it('시작하면 첫 사람이 던질 차례이고, 말 4개는 모두 집에 있다', () => {
    const e = new YutEngine();
    e.start(['a', 'b'], 'a', scripted());
    const v = view(e, 'a');
    expect(v.phase).toBe('throw');
    expect(v.yourActions).toEqual(['throw']);
    expect(view(e, 'b').yourActions).toEqual([]);
    expect(v.players.map((p) => p.marker)).toEqual(['A', 'B']);
    expect(v.players[0]!.home).toBe(4);
    expect(e.pendingPlayers()).toEqual(['a']);
  });

  it('걸이 나오면 이동 단계가 되고, 이벤트 문구가 한국어 조사까지 맞다', () => {
    const e = new YutEngine();
    e.start(['철수', '영희'], '철수', scripted('걸'));
    const ev = e.handleAction('철수', { name: 'throw' });
    expect(ev[0]!.text).toBe('철수님이 윷을 던져 [걸]이 나왔습니다.');
    const v = view(e, '철수');
    expect(v.phase).toBe('move');
    expect(v.yourActions).toEqual(['move']);
    expect(v.throws).toEqual([{ name: '걸', steps: 3 }]);
    // 집의 말은 대표 하나만 목록에 오른다.
    expect(v.moves).toEqual([{ throwIndex: 0, piece: 0, to: 3, stack: 1, capture: 0, path: [1, 2, 3] }]);
  });

  it('lastThrow.seq는 던질 때마다 1씩 늘어, 같은 결과를 연달아 던져도 구분된다', () => {
    const e = new YutEngine();
    e.start(['a', 'b'], 'a', scripted('윷', '윷'));
    const seqOf = () => (view(e, 'a') as unknown as { lastThrow: { seq: number } | null }).lastThrow?.seq;
    expect(seqOf()).toBeUndefined();
    e.handleAction('a', { name: 'throw' });
    const first = seqOf()!;
    e.handleAction('a', { name: 'throw' }); // 윷 → 한 번 더
    expect(seqOf()).toBe(first + 1);
  });

  it('윷·모가 나오면 한 번 더 던지고, 결과가 쌓인다', () => {
    const e = new YutEngine();
    e.start(['a', 'b'], 'a', scripted('윷', '모', '개'));
    e.handleAction('a', { name: 'throw' });
    expect(view(e, 'a').phase).toBe('throw');
    e.handleAction('a', { name: 'throw' });
    expect(view(e, 'a').phase).toBe('throw');
    e.handleAction('a', { name: 'throw' });
    const v = view(e, 'a');
    expect(v.phase).toBe('move');
    expect(v.throws.map((t) => t.name)).toEqual(['윷', '모', '개']);
    // 쌓인 결과를 하나씩 쓰고, 다 쓰면 다음 사람 차례.
    e.handleAction('a', { name: 'move', arg: { throwIndex: 2, piece: 0 } });
    e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } });
    expect(view(e, 'a').turnPlayer).toBe('a');
    const ev = e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } });
    expect(ev.at(-1)!.text).toBe('b님의 차례입니다.');
    // 2 + 4 = 6 → 모(5) 더해 11.
    expect(pieces(e, 'a')[0]).toEqual({ state: 'board', station: 11 });
  });

  it('상대 말을 잡으면 집으로 돌려보내고 한 번 더 던진다(남은 결과는 유지)', () => {
    const e = new YutEngine();
    e.start(['a', 'b'], 'a', scripted('걸', '윷', '걸'));
    e.handleAction('a', { name: 'throw' });
    e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } }); // a → 3
    e.handleAction('b', { name: 'throw' }); // 윷(한 번 더)
    e.handleAction('b', { name: 'throw' }); // 걸
    const capMove = view(e, 'b').moves.find((m) => m.throwIndex === 1)!;
    expect(capMove).toMatchObject({ to: 3, capture: 1 });
    const ev = e.handleAction('b', { name: 'move', arg: { throwIndex: 1, piece: 0 } });
    expect(ev.some((x) => x.text.includes('잡았습니다! 한 번 더 던집니다.'))).toBe(true);
    expect(pieces(e, 'a')[0]).toEqual({ state: 'home' });
    const v = view(e, 'b');
    expect(v.phase).toBe('throw');
    expect(v.yourActions).toEqual(['throw']);
    // 아직 안 쓴 [윷]은 그대로 남아 추가로 던진 뒤 함께 쓴다.
    expect(v.throws.map((t) => t.name)).toEqual(['윷']);
  });

  it('내 말 위에 도착하면 업고, 이후 한 덩어리로 움직이며 잡을 때도 함께 간다', () => {
    const e = new YutEngine();
    e.start(['a', 'b'], 'a', scripted('개', '도', '개', '걸', '도'));
    e.handleAction('a', { name: 'throw' });
    e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } }); // a0 → 2
    e.handleAction('b', { name: 'throw' });
    e.handleAction('b', { name: 'move', arg: { throwIndex: 0, piece: 0 } }); // b0 → 1
    e.handleAction('a', { name: 'throw' });
    const ev = e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 1 } }); // a1 → 2 (업기)
    expect(ev.some((x) => x.text.includes('업었습니다'))).toBe(true);
    e.handleAction('b', { name: 'throw' });
    e.handleAction('b', { name: 'move', arg: { throwIndex: 0, piece: 1 } }); // b1 → 3
    e.handleAction('a', { name: 'throw' }); // 도
    const mv = view(e, 'a').moves.find((m) => m.piece === 0)!;
    expect(mv).toMatchObject({ to: 3, stack: 2, capture: 1 });
    e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 1 } });
    const ap = pieces(e, 'a');
    expect(ap[0]).toEqual({ state: 'board', station: 3 });
    expect(ap[1]).toEqual({ state: 'board', station: 3 });
    expect(pieces(e, 'b')[1]).toEqual({ state: 'home' });
    expect(pieces(e, 'b')[0]).toEqual({ state: 'board', station: 1 });
    expect(view(e, 'a').phase).toBe('throw');
  });

  it('업힌 말이 잡히면 모두 집으로 돌아간다', () => {
    const e = new YutEngine();
    e.start(['a', 'b'], 'a', scripted());
    place(e, 'a', 0, 4, [0, 1, 2, 3, 4]);
    place(e, 'a', 1, 4, [0, 1, 2, 3, 4]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).turnIdx = 1;
    setPending(e, '윷');
    e.handleAction('b', { name: 'move', arg: { throwIndex: 0, piece: 0 } });
    expect(pieces(e, 'a').filter((p) => p.state === 'home')).toHaveLength(4);
  });

  describe('지름길', () => {
    function at(station: number, trail: number[], ...names: YutThrowName[]): YutEngine {
      const e = new YutEngine();
      e.start(['a', 'b'], 'a', scripted());
      place(e, 'a', 0, station, trail);
      setPending(e, ...names);
      return e;
    }

    it('모서리 5에 멈춘 말은 방 쪽 대각선으로 들어가 방을 지나면 15로 나간다', () => {
      const e = at(5, [0, 1, 2, 3, 4, 5], '도', '걸', '모');
      expect(destinations(e, 'a', 0)).toEqual([20, 22, 24]);
      // 5 → 20 → 21 → 22 → 23 → 24 → 15: 방을 지나갈 땐 직진(23)
      const e2 = at(21, [0, 1, 2, 3, 4, 5, 20, 21], '걸', '윷');
      expect(destinations(e2, 'a', 0)).toEqual([24, 15]);
    });

    it('모서리 10에 멈춘 말은 대각선으로 들어가 방을 지나 참먹이로 향한다', () => {
      const e = at(10, [10], '도', '걸', '모');
      expect(destinations(e, 'a', 0)).toEqual([25, 22, 28]);
      const e2 = at(26, [10, 25, 26], '개', '걸', '윷');
      expect(destinations(e2, 'a', 0)).toEqual([27, 28, 'done']);
    });

    it('방(22)에 멈춘 말은 어느 길로 왔든 27 → 28 → 참먹이로 간다', () => {
      const e = at(22, [5, 20, 21, 22], '도', '개', '걸');
      expect(destinations(e, 'a', 0)).toEqual([27, 28, 'done']);
    });

    it('모서리를 지나가기만 하면 꺾지 않고, 15에 멈춘 말은 둘레를 따라간다', () => {
      expect(destinations(at(4, [4], '개'), 'a', 0)).toEqual([6]);
      expect(destinations(at(8, [8], '걸'), 'a', 0)).toEqual([11]);
      expect(destinations(at(15, [15], '도'), 'a', 0)).toEqual([16]);
      expect(destinations(at(24, [24], '도'), 'a', 0)).toEqual([15]);
    });

    it('참먹이에 도달하거나 지나가면 난다', () => {
      expect(destinations(at(19, [19], '도'), 'a', 0)).toEqual(['done']);
      expect(destinations(at(18, [18], '모'), 'a', 0)).toEqual(['done']);
      expect(destinations(at(28, [28], '도'), 'a', 0)).toEqual(['done']);
    });
  });

  describe('이동 경로(path)', () => {
    function paths(station: number | 'home', trail: number[] | undefined, ...names: YutThrowName[]): (number[] | undefined)[] {
      const e = new YutEngine();
      e.start(['a', 'b'], 'a', scripted());
      if (station !== 'home') place(e, 'a', 0, station, trail);
      setPending(e, ...names);
      return (view(e, 'a').moves as (MoveView & { path?: number[] })[]).filter((m) => m.piece === 0).map((m) => m.path);
    }

    it('이번 이동에서 밟는 칸을 차례대로 싣는다(출발 칸은 빼고 도착 칸은 넣는다)', () => {
      expect(paths('home', undefined, '걸')).toEqual([[1, 2, 3]]);
      // 모서리 5에 멈춘 말은 대각선으로 꺾는다.
      expect(paths(5, [0, 1, 2, 3, 4, 5], '걸')).toEqual([[20, 21, 22]]);
    });

    it('나는 이동은 참먹이 전까지 밟은 칸만 싣는다', () => {
      expect(paths(18, [18], '모')).toEqual([[19]]);
    });

    it('빽도는 되돌아간 칸 하나다', () => {
      expect(paths(22, [10, 25, 26, 22], '빽도')).toEqual([[26]]);
    });
  });

  describe('빽도', () => {
    it('온 길을 따라 한 칸 되돌아간다(방에서는 들어온 쪽으로)', () => {
      const e = new YutEngine();
      e.start(['a', 'b'], 'a', scripted());
      place(e, 'a', 0, 22, [10, 25, 26, 22]);
      place(e, 'a', 1, 20, [0, 1, 2, 3, 4, 5, 20]);
      setPending(e, '빽도');
      expect(destinations(e, 'a', 0)).toEqual([26]);
      expect(destinations(e, 'a', 1)).toEqual([5]);
    });

    it('도 칸(1)에서의 빽도는 참먹이(0)에 판 위로 남고, 거기서 또 빽도면 19로 간다', () => {
      const e = new YutEngine();
      e.start(['a', 'b'], 'a', scripted());
      place(e, 'a', 0, 1, [0, 1]);
      setPending(e, '빽도', '빽도');
      e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } });
      expect(pieces(e, 'a')[0]).toEqual({ state: 'board', station: 0 });
      e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } });
      expect(pieces(e, 'a')[0]).toEqual({ state: 'board', station: 19 });
    });

    it('판에 말이 없으면 빽도는 버려지고 차례가 넘어간다', () => {
      const e = new YutEngine();
      e.start(['a', 'b'], 'a', scripted('빽도'));
      const ev = e.handleAction('a', { name: 'throw' });
      expect(ev.some((x) => x.text.includes('버립니다'))).toBe(true);
      expect(view(e, 'b').yourActions).toEqual(['throw']);
      expect(e.pendingPlayers()).toEqual(['b']);
    });

    it('다른 결과로 말을 올리면 쓸 수 있으므로 빽도를 바로 버리지 않는다', () => {
      const e = new YutEngine();
      e.start(['a', 'b'], 'a', scripted('윷', '빽도'));
      e.handleAction('a', { name: 'throw' });
      e.handleAction('a', { name: 'throw' });
      const v = view(e, 'a');
      expect(v.throws.map((t) => t.name)).toEqual(['윷', '빽도']);
      // 빽도(인덱스 1)로 집의 말을 옮기는 수는 없다.
      expect(v.moves.every((m) => m.throwIndex === 0)).toBe(true);
      expect(e.handleAction('a', { name: 'move', arg: { throwIndex: 1, piece: 0 } })).toEqual([]);
      e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } }); // → 4
      e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } }); // 빽도 → 3
      expect(pieces(e, 'a')[0]).toEqual({ state: 'board', station: 3 });
      expect(view(e, 'b').yourActions).toEqual(['throw']);
    });
  });

  it('무효 액션은 []를 돌려주고 상태를 바꾸지 않는다', () => {
    const e = new YutEngine();
    e.start(['a', 'b'], 'a', scripted('걸'));
    const before = JSON.stringify(view(e, 'a'));
    expect(e.handleAction('b', { name: 'throw' })).toEqual([]);
    expect(e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } })).toEqual([]);
    expect(e.handleAction('a', { name: 'nope' })).toEqual([]);
    expect(JSON.stringify(view(e, 'a'))).toBe(before);
    e.handleAction('a', { name: 'throw' });
    const mid = JSON.stringify(view(e, 'a'));
    for (const arg of [null, 3, {}, { throwIndex: 1, piece: 0 }, { throwIndex: 0, piece: 4 }, { throwIndex: 0.5, piece: 0 }, { throwIndex: 0, piece: '0' }]) {
      expect(e.handleAction('a', { name: 'move', arg })).toEqual([]);
    }
    expect(e.handleAction('a', { name: 'throw' })).toEqual([]);
    expect(JSON.stringify(view(e, 'a'))).toBe(mid);
  });

  it('말 4개를 모두 나면 게임이 끝나고, 나머지는 완주 수·진행도 순으로 순위가 매겨진다', () => {
    const e = new YutEngine();
    e.start(['a', 'b', 'c'], 'a', scripted());
    for (const i of [0, 1, 2]) place(e, 'a', i, 'done');
    place(e, 'a', 3, 19, [19]);
    place(e, 'b', 0, 'done');
    place(e, 'c', 0, 'done');
    place(e, 'c', 1, 18, [18]); // c가 b보다 진행도 앞섬
    setPending(e, '도', '걸');
    expect(e.result()).toBeNull();
    const ev = e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 3 } });
    expect(ev.some((x) => x.text.includes('승리'))).toBe(true);
    expect(e.isFinished()).toBe(true);
    expect(e.pendingPlayers()).toEqual([]);
    expect(e.defaultAction('a')).toBeNull();
    expect(e.result()!.ranking).toEqual([
      { nickname: 'a', detail: '4개 완주' },
      { nickname: 'c', detail: '1개 완주' },
      { nickname: 'b', detail: '1개 완주' },
    ]);
  });

  it('defaultAction만으로 2~6인 게임을 끝까지 진행할 수 있다', () => {
    for (let n = 2; n <= 6; n++) {
      for (let seed = 1; seed <= 8; seed++) {
        const e = new YutEngine();
        const players = Array.from({ length: n }, (_, i) => `p${i}`);
        e.start(players, 'p0', mulberry32(seed * 31 + n));
        let steps = 0;
        while (!e.isFinished() && steps < 20000) {
          const pending = e.pendingPlayers();
          expect(pending).toHaveLength(1);
          const p = pending[0]!;
          const before = JSON.stringify(view(e, p));
          const act = e.defaultAction(p)!;
          expect(act).not.toBeNull();
          // defaultAction은 순수하다.
          expect(JSON.stringify(view(e, p))).toBe(before);
          const ev = e.handleAction(p, act);
          expect(ev.length).toBeGreaterThan(0);
          steps++;
        }
        expect(e.isFinished()).toBe(true);
        const ranking = e.result()!.ranking;
        expect(ranking).toHaveLength(n);
        expect(ranking[0]!.detail).toBe('4개 완주');
      }
    }
  });

  describe('removePlayer', () => {
    it('차례인 사람이 이동 도중 나가면 그 말이 사라지고 다음 사람이 새로 던진다', () => {
      const e = new YutEngine();
      e.start(['a', 'b', 'c'], 'a', scripted('윷', '걸'));
      e.handleAction('a', { name: 'throw' });
      e.handleAction('a', { name: 'throw' });
      e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } });
      const ev = e.removePlayer('a');
      expect(ev[0]!.text).toBe('a님이 게임을 떠났습니다.');
      expect(e.pendingPlayers()).toEqual(['b']);
      const v = view(e, 'b');
      expect(v.phase).toBe('throw');
      expect(v.throws).toEqual([]);
      expect(v.players.map((p) => p.nickname)).toEqual(['b', 'c']);
      expect(v.players.map((p) => p.marker)).toEqual(['B', 'C']);
    });

    it('차례보다 앞선 사람이 나가도 현재 차례와 진행 상태가 유지된다', () => {
      const e = new YutEngine();
      e.start(['a', 'b', 'c'], 'a', scripted('개', '윷', '걸'));
      e.handleAction('a', { name: 'throw' });
      e.handleAction('a', { name: 'move', arg: { throwIndex: 0, piece: 0 } });
      e.handleAction('b', { name: 'throw' });
      e.handleAction('b', { name: 'throw' });
      e.removePlayer('a');
      expect(e.pendingPlayers()).toEqual(['b']);
      expect(view(e, 'b').throws.map((t) => t.name)).toEqual(['윷', '걸']);
    });

    it('2명 남은 게임에서 한 명이 나가면 남은 사람이 승리한다', () => {
      const e = new YutEngine();
      e.start(['a', 'b'], 'a', scripted());
      e.removePlayer('a');
      expect(e.isFinished()).toBe(true);
      expect(e.result()!.ranking[0]!.nickname).toBe('b');
      expect(e.removePlayer('zzz')).toEqual([]);
    });
  });
});

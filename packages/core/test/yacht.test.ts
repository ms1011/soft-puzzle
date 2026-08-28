import { it, expect, describe } from 'vitest';
import { scoreCategory, YachtEngine, type YachtCategory } from '../src/games/yacht.js';
import { mulberry32 } from '../src/rng.js';

describe('scoreCategory', () => {
  it.each([
    [[1, 1, 2, 3, 4], 'ones', 2],
    [[6, 6, 6, 2, 2], 'sixes', 18],
    [[3, 3, 3, 2, 5], 'threeKind', 16],
    [[3, 3, 2, 2, 5], 'threeKind', 0],
    [[4, 4, 4, 4, 2], 'fourKind', 18],
    [[2, 2, 3, 3, 3], 'fullHouse', 25],
    [[5, 5, 5, 5, 5], 'fullHouse', 25],
    [[2, 2, 3, 3, 4], 'fullHouse', 0],
    [[1, 2, 3, 4, 6], 'smallStraight', 30],
    [[2, 3, 4, 5, 6], 'smallStraight', 30],
    [[1, 2, 3, 5, 6], 'smallStraight', 0],
    [[1, 2, 3, 4, 5], 'largeStraight', 40],
    [[1, 2, 3, 4, 6], 'largeStraight', 0],
    [[4, 4, 4, 4, 4], 'yacht', 50],
    [[1, 3, 5, 2, 6], 'chance', 17],
  ])('scoreCategory(%j, %s) = %i', (dice, cat, expected) => {
    expect(scoreCategory(dice as number[], cat as YachtCategory)).toBe(expected);
  });
});

/** 13칸 고정 순서 — 테스트에서 결정적으로 순서대로 채워나가는 용도. */
const ALL_CATS: YachtCategory[] = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
  'chance',
];

function view(e: YachtEngine, player: string): any {
  return e.getViewFor(player);
}

describe('YachtEngine', () => {
  it('① 시작하면 첫 플레이어 주사위 5개가 굴려져 있고 rollsLeft 2다', () => {
    const e = new YachtEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    const v = view(e, '철수');
    expect(v.turnPlayer).toBe('철수');
    expect(v.dice).toHaveLength(5);
    for (const d of v.dice) expect(d).toBeGreaterThanOrEqual(1);
    for (const d of v.dice) expect(d).toBeLessThanOrEqual(6);
    expect(v.rollsLeft).toBe(2);
    expect(v.held).toEqual([false, false, false, false, false]);
    expect(v.yourActions).toEqual(['reroll', 'toggleHold', 'score']);
    // 아직 시작 전인 다른 플레이어는 행동할 게 없다.
    expect(view(e, '영희').yourActions).toEqual([]);
  });

  it('② reroll은 홀드된 주사위는 그대로 두고 홀드 안 된 주사위만 바꾼다', () => {
    const e = new YachtEngine();
    e.start(['철수'], '철수', mulberry32(1));
    const before = view(e, '철수').dice as number[];

    // 0~3번은 홀드, 4번만 리롤 대상으로 남긴다.
    for (let i = 0; i < 4; i++) e.handleAction('철수', { name: 'toggleHold', arg: i });
    const events = e.handleAction('철수', { name: 'reroll' });
    expect(events.length).toBeGreaterThan(0);

    const after = view(e, '철수');
    expect(after.dice.slice(0, 4)).toEqual(before.slice(0, 4)); // 홀드된 4개는 불변
    expect(after.rollsLeft).toBe(1);
    // 버그(전체 리롤)라면 4개 모두 우연히 같은 값으로 남을 확률은 (1/6)^4 ≈ 0.08%로 사실상 0.
  });

  it('③ reroll 2회를 다 쓰면 yourActions에 reroll이 없고, 더 시도해도 무시되어 상태가 그대로다', () => {
    const e = new YachtEngine();
    e.start(['철수'], '철수', mulberry32(1));
    e.handleAction('철수', { name: 'reroll' });
    e.handleAction('철수', { name: 'reroll' });
    const v = view(e, '철수');
    expect(v.rollsLeft).toBe(0);
    expect(v.yourActions).toEqual(['toggleHold', 'score']);

    const before = JSON.stringify(view(e, '철수'));
    const events = e.handleAction('철수', { name: 'reroll' });
    expect(events).toEqual([]);
    expect(JSON.stringify(view(e, '철수'))).toBe(before); // 상태 완전히 불변
  });

  it('④ 이미 채운 카테고리에 score하면 무시되고 상태가 완전히 그대로 유지된다', () => {
    const e = new YachtEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.handleAction('철수', { name: 'score', arg: 'chance' });
    // 이제 턴은 영희로 넘어갔다 — 철수가 이미 쓴 chance를 다시 시도하는 건 turnIdx 검사에도 걸리지만,
    // "이미 쓴 카테고리" 자체의 무효화도 검증하기 위해 영희 턴에 같은 값을 넣지 않고,
    // 철수 턴이 다시 돌아왔을 때 이미 채운 chance로 재시도한다.
    e.handleAction('영희', { name: 'score', arg: 'chance' }); // 턴을 철수로 되돌리기 위함
    expect(view(e, '철수').turnPlayer).toBe('철수');

    const before = JSON.stringify(view(e, '철수'));
    const events = e.handleAction('철수', { name: 'score', arg: 'chance' }); // 이미 쓴 카테고리
    expect(events).toEqual([]);
    expect(JSON.stringify(view(e, '철수'))).toBe(before);
  });

  it('⑤ 상단(ones~sixes) 합이 63 이상이면 보너스 35가 총점에 더해진다', () => {
    // seed=60에서 "목표 눈만 홀드하고 나머지를 최대 2번 리롤" 전략으로 상단 6칸을 순서대로
    // 채우면 상단 합계 72(>=63)가 나온다 — 이 시드는 동일한 전략을 1~500까지 탐색하는
    // 임시 스크립트로 미리 찾아둔 값이다(스크립트 자체는 커밋 대상이 아니라 보존하지 않음).
    const e = new YachtEngine();
    e.start(['혼자'], '혼자', mulberry32(60));
    const targets = [6, 5, 4, 3, 2, 1] as const;
    const catByFace: Record<number, YachtCategory> = {
      6: 'sixes',
      5: 'fives',
      4: 'fours',
      3: 'threes',
      2: 'twos',
      1: 'ones',
    };

    for (const face of targets) {
      for (let r = 0; r < 2; r++) {
        const v = view(e, '혼자');
        v.dice.forEach((d: number, i: number) => {
          if (d === face && !v.held[i]) e.handleAction('혼자', { name: 'toggleHold', arg: i });
        });
        e.handleAction('혼자', { name: 'reroll' });
      }
      const v = view(e, '혼자');
      v.dice.forEach((d: number, i: number) => {
        if (d === face && !v.held[i]) e.handleAction('혼자', { name: 'toggleHold', arg: i });
      });
      e.handleAction('혼자', { name: 'score', arg: catByFace[face] });
    }

    const me = view(e, '혼자').players.find((p: any) => p.nickname === '혼자');
    expect(me.upperTotal).toBe(72);
    expect(me.bonus).toBe(35);
    expect(me.total).toBe(72 + 35); // 상단 합 + 하단은 아직 0점(미기록) → 보너스만 반영
  });

  it('⑥ 혼자(1인) 플레이가 끝까지 가능하다', () => {
    const e = new YachtEngine();
    e.start(['혼자'], '혼자', mulberry32(7));
    expect(e.minPlayers).toBe(1);

    for (const cat of ALL_CATS) {
      expect(e.isFinished()).toBe(false);
      expect(e.pendingPlayers()).toEqual(['혼자']); // 1인이어도 절대 비지 않는다
      expect(view(e, '혼자').turnPlayer).toBe('혼자'); // 매턴 같은(유일한) 사람에게 돌아온다
      const events = e.handleAction('혼자', { name: 'score', arg: cat });
      expect(events.length).toBeGreaterThan(0);
    }

    expect(e.isFinished()).toBe(true);
    expect(e.pendingPlayers()).toEqual([]);
    const result = e.result();
    expect(result).not.toBeNull();
    expect(result!.ranking).toHaveLength(1);
    expect(result!.ranking[0].nickname).toBe('혼자');
    expect(result!.ranking[0].detail).toMatch(/^\d+점$/);
  });

  it('⑦ 13칸 모두 채우면 isFinished()와 총점 랭킹이 나온다', () => {
    const e = new YachtEngine();
    const players = ['철수', '영희'];
    e.start(players, '철수', mulberry32(3));
    const nextIdx: Record<string, number> = { 철수: 0, 영희: 0 };

    let guard = 0;
    while (!e.isFinished()) {
      expect(guard++).toBeLessThan(1000); // 무한루프(교착) 방지용 안전장치
      const turn = e.pendingPlayers()[0];
      expect(turn).toBeDefined(); // 안 끝났으면 반드시 누군가 pending이어야 한다
      const cat = ALL_CATS[nextIdx[turn]++];
      const events = e.handleAction(turn, { name: 'score', arg: cat });
      expect(events.length).toBeGreaterThan(0);
    }

    expect(e.isFinished()).toBe(true);
    expect(e.pendingPlayers()).toEqual([]);
    expect(nextIdx['철수']).toBe(13);
    expect(nextIdx['영희']).toBe(13);

    const result = e.result();
    expect(result).not.toBeNull();
    expect(result!.ranking).toHaveLength(2);
    expect(result!.ranking.map((r) => r.nickname).sort()).toEqual(['영희', '철수']);
    result!.ranking.forEach((r) => expect(r.detail).toMatch(/^\d+점$/));
    const amounts = result!.ranking.map((r) => Number(r.detail.replace('점', '')));
    expect(amounts[0]).toBeGreaterThanOrEqual(amounts[1]); // 총점 내림차순

    // result()의 총점이 view의 sheet를 직접 합산한 값과 일치하는지 교차검증한다
    // (totalFor와 summarize가 같은 버그를 공유하면 못 잡으므로, 별도로 직접 합산한다).
    const v = view(e, '철수');
    for (const p of v.players as any[]) {
      const upperSum = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']
        .map((c) => p.sheet[c] as number)
        .reduce((a, b) => a + b, 0);
      const manualBonus = upperSum >= 63 ? 35 : 0;
      const manualTotal =
        (Object.values(p.sheet) as number[]).reduce((a, b) => a + b, 0) + manualBonus;
      expect(p.total).toBe(manualTotal);
      const fromRanking = result!.ranking.find((r) => r.nickname === p.nickname)!;
      expect(fromRanking.detail).toBe(`${manualTotal}점`);
    }
  });

  describe('무효 액션은 상태를 바꾸지 않는다', () => {
    it('내 턴이 아니면 무시된다', () => {
      const e = new YachtEngine();
      e.start(['철수', '영희'], '철수', mulberry32(1));
      const before = JSON.stringify(view(e, '영희'));
      expect(e.handleAction('영희', { name: 'reroll' })).toEqual([]);
      expect(e.handleAction('영희', { name: 'score', arg: 'chance' })).toEqual([]);
      expect(JSON.stringify(view(e, '영희'))).toBe(before);
    });

    it('yourActions에 없는 액션 이름은 무시된다', () => {
      const e = new YachtEngine();
      e.start(['철수'], '철수', mulberry32(1));
      const before = JSON.stringify(view(e, '철수'));
      expect(e.handleAction('철수', { name: 'notARealAction' })).toEqual([]);
      expect(JSON.stringify(view(e, '철수'))).toBe(before);
    });

    it('toggleHold의 인덱스가 범위를 벗어나면 무시된다', () => {
      const e = new YachtEngine();
      e.start(['철수'], '철수', mulberry32(1));
      const before = JSON.stringify(view(e, '철수'));
      expect(e.handleAction('철수', { name: 'toggleHold', arg: -1 })).toEqual([]);
      expect(e.handleAction('철수', { name: 'toggleHold', arg: 5 })).toEqual([]);
      expect(e.handleAction('철수', { name: 'toggleHold', arg: 1.5 })).toEqual([]);
      expect(e.handleAction('철수', { name: 'toggleHold', arg: 'zero' })).toEqual([]);
      expect(JSON.stringify(view(e, '철수'))).toBe(before);
    });

    it('score에 존재하지 않는 카테고리 이름을 주면 무시된다', () => {
      const e = new YachtEngine();
      e.start(['철수'], '철수', mulberry32(1));
      const before = JSON.stringify(view(e, '철수'));
      expect(e.handleAction('철수', { name: 'score', arg: 'notACategory' })).toEqual([]);
      expect(e.handleAction('철수', { name: 'score', arg: 42 })).toEqual([]);
      expect(JSON.stringify(view(e, '철수'))).toBe(before);
    });
  });

  describe('defaultAction', () => {
    it('chance가 비어 있으면 chance를 반환한다', () => {
      const e = new YachtEngine();
      e.start(['철수'], '철수', mulberry32(1));
      expect(e.defaultAction('철수')).toEqual({ name: 'score', arg: 'chance' });
    });

    it('chance가 이미 쓰였으면 남은 카테고리 중 지금 주사위로 가장 높은 점수를 주는 것을 반환한다', () => {
      const e = new YachtEngine();
      e.start(['철수'], '철수', mulberry32(1));
      e.handleAction('철수', { name: 'score', arg: 'chance' });
      const suggestion = e.defaultAction('철수');
      expect(suggestion).not.toBeNull();
      expect(suggestion!.name).toBe('score');
      const cat = suggestion!.arg as YachtCategory;
      expect(cat).not.toBe('chance'); // 이미 쓴 칸을 다시 고르면 안 된다

      const dice = view(e, '철수').dice as number[];
      const suggestedScore = scoreCategory(dice, cat);
      for (const other of ALL_CATS) {
        if (other === 'chance' || other === cat) continue;
        expect(suggestedScore).toBeGreaterThanOrEqual(scoreCategory(dice, other));
      }
    });

    it('내 턴이 아니면 null을 반환한다', () => {
      const e = new YachtEngine();
      e.start(['철수', '영희'], '철수', mulberry32(1));
      expect(e.defaultAction('영희')).toBeNull();
    });

    it('순수 조회다 — 몇 번을 호출해도 엔진 상태를 바꾸지 않는다', () => {
      const e = new YachtEngine();
      e.start(['철수', '영희'], '철수', mulberry32(1));
      const before = JSON.stringify(view(e, '철수'));
      e.defaultAction('철수');
      e.defaultAction('철수'); // 두 번 호출해도(Room이 힌트 표시용으로 먼저 조회하는 경우 등)
      expect(JSON.stringify(view(e, '철수'))).toBe(before);
      expect(e.pendingPlayers()).toEqual(['철수']); // 턴이 넘어가거나 점수가 채워지지 않았다

      // 내 턴이 아닌 사람에게 물어봐도(null 반환 경로) 상태는 그대로다.
      e.defaultAction('영희');
      e.defaultAction('영희');
      expect(JSON.stringify(view(e, '철수'))).toBe(before);
    });
  });

  describe('removePlayer — 이탈해도 교착 상태가 되지 않는다', () => {
    it('현재 턴인 플레이어가 이탈하면 다음 사람 턴을 새로 시작한다', () => {
      const e = new YachtEngine();
      e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
      expect(e.pendingPlayers()).toEqual(['철수']);
      const events = e.removePlayer('철수');
      expect(events.length).toBeGreaterThan(0);
      expect(e.isFinished()).toBe(false);
      expect(e.pendingPlayers()).toEqual(['영희']); // 민수로 건너뛰지 않는다
      expect(view(e, '영희').rollsLeft).toBe(2); // 새 턴이 굴려져 있다
    });

    it('턴이 아닌 플레이어가 이탈해도 현재 턴은 그대로 진행된다', () => {
      const e = new YachtEngine();
      e.start(['철수', '영희'], '철수', mulberry32(1));
      const diceBefore = view(e, '철수').dice;
      const events = e.removePlayer('영희');
      expect(events.length).toBeGreaterThan(0);
      expect(e.pendingPlayers()).toEqual(['철수']);
      expect(view(e, '철수').dice).toEqual(diceBefore); // 턴 다시 시작 안 됨
    });

    it('혼자 남은 마지막 플레이어가 이탈하면 그 즉시 종료된다 (대기자 없이 멈추지 않는다)', () => {
      const e = new YachtEngine();
      e.start(['철수'], '철수', mulberry32(1));
      expect(e.isFinished()).toBe(false);
      const events = e.removePlayer('철수');
      expect(events.length).toBeGreaterThan(0);
      expect(e.isFinished()).toBe(true);
      expect(e.pendingPlayers()).toEqual([]);
    });

    it('알 수 없는 플레이어를 제거 요청하면 무시된다', () => {
      const e = new YachtEngine();
      e.start(['철수'], '철수', mulberry32(1));
      expect(e.removePlayer('없는사람')).toEqual([]);
    });
  });
});

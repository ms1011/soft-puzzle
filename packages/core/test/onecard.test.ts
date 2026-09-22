import { it, expect, describe } from 'vitest';
import { canPlay, OneCardEngine } from '../src/games/onecard.js';
import { mulberry32 } from '../src/rng.js';
import type { Suit, Card } from '../src/card.js';

describe('canPlay', () => {
  it.each([
    ['KH', 'KD', null, 0, true], // 같은 랭크
    ['KH', '2H', null, 0, true], // 같은 무늬
    ['KH', '2D', null, 0, false],
    ['KH', '7S', 'H', 0, true], // 7 선언 무늬 따름
    ['2H', '2D', null, 2, true], // 공격 되받기: 2 위에 2
    ['AH', '2D', null, 2, false], // 2 공격에 A로 응수 불가
    ['3H', '2H', null, 2, false], // 3 방어 없음
    ['JB', 'KS', null, 0, true], // 흑조커는 검정 위 OK
    ['JB', 'KH', null, 0, false],
    ['JR', 'JB', null, 5, true], // 조커 위 조커 (흑/적 무관)
    ['5H', 'JR', null, 0, true], // 공격 해소된 조커 바닥 위엔 아무 카드
  ] as [Card, Card, Suit | null, number, boolean][])(
    'canPlay(%s on %s, declared=%s, stack=%i) = %s',
    (c, t, d, s, ok) => {
      expect(canPlay(c, t, d, s)).toBe(ok);
    },
  );
});

function view(e: OneCardEngine, player: string): any {
  return e.getViewFor(player);
}

/** hands 맵을 만드는 편의 함수 */
function h(...pairs: [string, Card[]][]): Map<string, Card[]> {
  return new Map(pairs);
}

describe('OneCardEngine', () => {
  it('view.drawPileCount는 지금 뽑을 수 있는 장수다(덱 54 - 손패 14 - 바닥 1, 뽑으면 줄어든다)', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    const before = view(e, '영희').drawPileCount;
    expect(before).toBe(54 - 14 - 1);
    e.handleAction('철수', { name: 'draw' });
    expect(view(e, '영희').drawPileCount).toBeLessThan(before);
  });

  it('① 시작하면 각자 7장씩 받고 top이 1장 있다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    const v1 = view(e, '철수');
    const v2 = view(e, '영희');
    expect((v1.you as any).hand).toHaveLength(7);
    expect((v2.you as any).hand).toHaveLength(7);
    expect(typeof v1.top).toBe('string');
    expect(v1.top).toBe(v2.top);
    // 자신의 손패와 상대 손패가 겹치지 않는다 (같은 카드가 중복 등장하지 않음).
    const mine = new Set((v1.you as any).hand as Card[]);
    for (const c of (v2.you as any).hand as Card[]) {
      expect(mine.has(c)).toBe(false);
    }
    expect(v1.attackStack).toBe(0);
    expect(v1.declaredSuit).toBeNull();
  });

  it('② 낼 수 없는 카드를 play하면 무시되고 상태가 완전히 그대로다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    // 철수 손패를 top(KD)과 무늬/랭크가 전혀 안 맞는 카드로 세팅.
    e.setHands(h(['철수', ['3H']], ['영희', ['4C']]), 'KD');
    const before = JSON.stringify(view(e, '철수'));
    const events = e.handleAction('철수', { name: 'play', arg: { card: '3H' } });
    expect(events).toEqual([]);
    expect(JSON.stringify(view(e, '철수'))).toBe(before);
    expect(e.pendingPlayers()).toEqual(['철수']); // 턴도 그대로
  });

  it('③ 2를 내면 다음 사람 attackStack이 2가 되고, draw하면 2장 받고 스택이 0으로 리셋된다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    // 2D는 2H와 랭크(2)가 같아 낼 수 있다. 철수에게는 여분 카드(9S)를 더 줘서 이 play로
    // 완주하지 않게 한다(이 테스트는 attackStack 메커니즘만 확인한다).
    e.setHands(h(['철수', ['2D', '9S']], ['영희', ['9C']]), '2H');
    const events = e.handleAction('철수', { name: 'play', arg: { card: '2D' } });
    expect(events.length).toBeGreaterThan(0);
    expect(view(e, '영희').attackStack).toBe(2);
    expect(e.pendingPlayers()).toEqual(['영희']);

    const beforeHand = (view(e, '영희').you as any).hand as Card[];
    expect(beforeHand).toHaveLength(1);
    const drawEvents = e.handleAction('영희', { name: 'draw' });
    expect(drawEvents.length).toBeGreaterThan(0);
    const afterHand = (view(e, '영희').you as any).hand as Card[];
    expect(afterHand).toHaveLength(3); // 원래 1장 + 2장 드로우
    expect(view(e, '영희').attackStack).toBe(0);
    expect(e.pendingPlayers()).toEqual(['철수']); // 턴이 다시 넘어감
  });

  it('④ 공격 되받기가 누적된다 (2 → 2 = 스택 4)', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['2D', '9S']], ['영희', ['2S', '9C']]), '2H');
    e.handleAction('철수', { name: 'play', arg: { card: '2D' } });
    expect(view(e, '영희').attackStack).toBe(2);

    const events = e.handleAction('영희', { name: 'play', arg: { card: '2S' } });
    expect(events.length).toBeGreaterThan(0);
    expect(view(e, '철수').attackStack).toBe(4); // 누적: 2 + 2
    expect(e.pendingPlayers()).toEqual(['철수']);
  });

  it('⑤-a J를 내면 다음 사람이 건너뛰어진다 (3인전)', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['JS']], ['영희', ['9C']], ['민수', ['9D']]), '10S');
    e.handleAction('철수', { name: 'play', arg: { card: 'JS' } });
    // 영희가 건너뛰어지고 민수 턴이 된다.
    expect(e.pendingPlayers()).toEqual(['민수']);
  });

  it('⑤-b Q를 내면 진행 방향이 바뀐다 (3인전)', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['QS']], ['영희', ['9C']], ['민수', ['9D']]), '10S');
    expect(view(e, '철수').direction).toBe(1);
    e.handleAction('철수', { name: 'play', arg: { card: 'QS' } });
    expect(view(e, '철수').direction).toBe(-1);
    // 방향이 뒤집혔으므로 영희(순방향의 다음)가 아니라 민수(역방향의 다음) 차례가 된다.
    expect(e.pendingPlayers()).toEqual(['민수']);
  });

  it('⑤-b-2 2인전에서는 Q를 내도 방향이 바뀌지 않고(효과 없음) 상대 턴으로 그대로 넘어간다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['QS', '3D']], ['영희', ['9C']]), '10S');
    e.handleAction('철수', { name: 'play', arg: { card: 'QS' } });
    expect(view(e, '철수').direction).toBe(1); // 2인전에서는 방향 변경 자체가 없다
    expect(e.pendingPlayers()).toEqual(['영희']);
  });

  it('⑤-c K를 내면 같은 플레이어의 턴이 유지된다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['KS', '9S']], ['영희', ['9C']]), '10S');
    const events = e.handleAction('철수', { name: 'play', arg: { card: 'KS' } });
    expect(events.length).toBeGreaterThan(0);
    expect(e.pendingPlayers()).toEqual(['철수']); // 여전히 철수 턴
    expect((view(e, '철수').you as any).hand).toEqual(['9S']); // 카드는 실제로 줄었다
  });

  it('⑤-d 7을 내면 무늬를 선언해야 하고, 선언 무늬가 다음 판정 기준이 된다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['7S', '9H']], ['영희', ['4D', '9S']]), '10S');

    // declareSuit 없이 내면 거부되고 상태 불변.
    const before = JSON.stringify(view(e, '철수'));
    const rejected = e.handleAction('철수', { name: 'play', arg: { card: '7S' } });
    expect(rejected).toEqual([]);
    expect(JSON.stringify(view(e, '철수'))).toBe(before);

    // 엉터리 declareSuit도 거부.
    expect(e.handleAction('철수', { name: 'play', arg: { card: '7S', declareSuit: 'X' } })).toEqual(
      [],
    );

    const events = e.handleAction('철수', {
      name: 'play',
      arg: { card: '7S', declareSuit: 'D' },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(view(e, '영희').declaredSuit).toBe('D');
    expect(view(e, '영희').top).toBe('7S');
    // 4D는 선언된 무늬(D)와 일치하므로 낼 수 있어야 한다.
    const playEvents = e.handleAction('영희', { name: 'play', arg: { card: '4D' } });
    expect(playEvents.length).toBeGreaterThan(0);
    expect(view(e, '철수').top).toBe('4D');
    expect(view(e, '철수').declaredSuit).toBeNull(); // 7이 아닌 카드가 나왔으니 선언 해제
  });

  it('⑥ 마지막 카드를 내면 완주 처리되고 랭킹에 등록되며 게임이 끝난다 (2인전)', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['9S']], ['영희', ['4D']]), '10S');
    expect(e.isFinished()).toBe(false);
    const events = e.handleAction('철수', { name: 'play', arg: { card: '9S' } });
    expect(events.length).toBeGreaterThan(0);
    expect(e.isFinished()).toBe(true);
    expect(e.pendingPlayers()).toEqual([]);
    const result = e.result();
    expect(result).not.toBeNull();
    expect(result!.ranking.map((r) => r.nickname)).toEqual(['철수', '영희']);
  });

  it('⑦ 손패가 15장 이상이 되면 파산 탈락하고 순위 하위권으로 등록된다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
    // 철수 손패를 top과 전혀 안 맞는 카드 14장으로 채워 draw를 강제한다.
    const uselessHand: Card[] = [
      'AH',
      '3H',
      '4H',
      '5H',
      '6H',
      '7H',
      '8H',
      '9H',
      '10H',
      'JH',
      'QH',
      'KH',
      '3S',
      '4S',
    ]; // 모두 무늬 H/S(≠C), 랭크 ≠ 2 — top(2C)과 무늬·랭크 어느 쪽으로도 안 맞는다.
    e.setHands(h(['철수', uselessHand], ['영희', ['9C']], ['민수', ['9D']]), '2C'); // top은 클럽 2 (철수 손패와 무관)
    expect(uselessHand).toHaveLength(14);
    for (const c of uselessHand) {
      expect(canPlay(c, '2C', null, 0)).toBe(false);
    }
    const events = e.handleAction('철수', { name: 'draw' });
    expect(events.length).toBeGreaterThan(0);
    expect(e.pendingPlayers()).toEqual(['영희']); // 철수는 탈락, 턴은 다음으로
    expect(e.isFinished()).toBe(false); // 아직 2명 남음

    // 나머지 플레이어도 정리해서 게임을 끝내고 랭킹을 확인한다.
    e.setHands(h(['영희', ['9C']], ['민수', ['9D']]), '2C');
    e.removePlayer('민수');
    expect(e.isFinished()).toBe(true);
    const result = e.result()!;
    const names = result.ranking.map((r) => r.nickname);
    // 철수(파산)는 완주자보다 아래여야 한다.
    expect(names.indexOf('철수')).toBe(names.length - 1);
    expect(names).toContain('영희');
  });

  it('K가 마지막 카드일 때는 한 번 더가 적용되지 않고 다음 사람에게 정상적으로 턴이 넘어간다 (3인전)', () => {
    // K의 "한 번 더"는 낸 사람이 계속 있을 때만 의미가 있다. 완주로 그 사람이 사라지는
    // 경우까지 steps=0(제자리)으로 처리하면, 이미 order에서 빠진 플레이어의 인덱스를 그대로
    // 쓰게 되어 턴이 엉뚱한 사람에게(혹은 아무에게도) 넘어가지 않는 버그가 될 수 있다.
    const e = new OneCardEngine();
    e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['KS']], ['영희', ['9C']], ['민수', ['9D']]), '10S');
    const events = e.handleAction('철수', { name: 'play', arg: { card: 'KS' } });
    expect(events.length).toBeGreaterThan(0);
    expect(e.isFinished()).toBe(false); // 3인전이라 아직 안 끝남 (2명 남음)
    expect(e.pendingPlayers()).toEqual(['영희']); // 철수가 아니라 영희로 정상 진행
  });

  it('Q로 뒤집힌 방향이 이후의 J 스킵 계산에도 실제로 반영된다 (4인전)', () => {
    const e = new OneCardEngine();
    e.start(['P1', 'P2', 'P3', 'P4'], 'P1', mulberry32(1));
    e.setHands(
      h(['P1', ['QS', '3D']], ['P2', ['9H']], ['P3', ['9C']], ['P4', ['JS', '9D']]),
      '10S',
    );
    e.handleAction('P1', { name: 'play', arg: { card: 'QS' } });
    expect(view(e, 'P1').direction).toBe(-1);
    expect(e.pendingPlayers()).toEqual(['P4']); // 방향이 뒤집혔으므로 역방향의 다음인 P4

    e.handleAction('P4', { name: 'play', arg: { card: 'JS' } });
    // 역방향(P4→P3→P2→P1→...)에서 J로 한 명(P3)을 건너뛰면 P2가 된다.
    expect(e.pendingPlayers()).toEqual(['P2']);
  });

  it('공격이 draw로 해소된 뒤 top이 조커면 무늬/랭크가 전혀 안 맞는 카드도 실제로 낼 수 있다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    // JB(흑조커)는 검정 무늬(KS) 위에 낼 수 있다.
    e.setHands(h(['철수', ['JB', '4D']], ['영희', ['9H']]), 'KS');
    e.handleAction('철수', { name: 'play', arg: { card: 'JB' } }); // 공격 발동(+5), top=JB
    expect(view(e, '영희').attackStack).toBe(5);
    expect(view(e, '영희').top).toBe('JB');

    e.handleAction('영희', { name: 'draw' }); // 되받지 않고 5장 드로우 → 공격 해소, top은 그대로 JB
    expect(view(e, '철수').attackStack).toBe(0);
    expect(view(e, '철수').top).toBe('JB');
    expect(e.pendingPlayers()).toEqual(['철수']);

    // 4D는 하트도 다이아도 아닌 top(JB, 조커 무늬 없음)과 무늬/랭크가 전혀 안 맞지만,
    // 공격이 해소된 조커 위이므로 어떤 카드든 낼 수 있어야 한다.
    expect(canPlay('4D', 'JB', null, 0)).toBe(true);
    const events = e.handleAction('철수', { name: 'play', arg: { card: '4D' } });
    expect(events.length).toBeGreaterThan(0);
    expect(e.isFinished()).toBe(true); // 철수의 마지막 카드였으므로 완주로 게임 종료 (2인전)
  });

  it('조커 색 제약은 실제 handleAction 경로에서도 거부된다 (적조커를 검정 무늬 위에)', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['JR', '9S']], ['영희', ['9H']]), 'KS'); // top은 검정(스페이드)
    const before = JSON.stringify(view(e, '철수'));
    const events = e.handleAction('철수', { name: 'play', arg: { card: 'JR' } });
    expect(events).toEqual([]);
    expect(JSON.stringify(view(e, '철수'))).toBe(before);
  });

  it('⑧ 드로우 더미가 소진되면 버린 더미(top 제외)가 재셔플되어 draw가 계속 가능하다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['5H']], ['영희', ['9C']]), '5S');

    // 화이트박스: 테스트 전용 setHands가 다루지 않는 drawPile/discard를 직접 조작해
    // "더미 소진 직전" 상태를 만든다. (private 필드지만 JS 런타임 레벨에서는 접근 가능하며,
    // 리셔플 분기를 재현할 다른 사공인 방법이 없어 의도적으로 사용한다.)
    const internal = e as unknown as { drawPile: Card[]; discard: Card[] };
    internal.drawPile = [];
    internal.discard = ['3C', '4C', '6C']; // top(5S) 제외한 카드들

    const before = (view(e, '철수').you as any).hand as Card[];
    expect(before).toHaveLength(1);

    // 철수는 낼 수 있는 카드(5H, top 5S와 랭크 일치)가 있지만 draw를 선택해 리셔플을 유도한다.
    const events = e.handleAction('철수', { name: 'draw' });
    expect(events.length).toBeGreaterThan(0);

    const after = (view(e, '철수').you as any).hand as Card[];
    expect(after).toHaveLength(2); // 드로우 성공 (더미가 비어 있었다면 실패했을 것)
    expect(internal.discard).toHaveLength(0); // discard는 리셔플되어 drawPile로 이동, 비어야 함
    // top(5S)은 여전히 그대로 유지된다 (재셔플 대상에서 제외됨).
    expect(view(e, '철수').top).toBe('5S');
  });

  it('내 턴이 아니면 액션이 무시되고 상태가 그대로다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['9S']], ['영희', ['9D']]), '10S');
    const before = JSON.stringify(view(e, '영희'));
    expect(e.handleAction('영희', { name: 'play', arg: { card: '9D' } })).toEqual([]);
    expect(JSON.stringify(view(e, '영희'))).toBe(before);
  });

  it('내가 들고 있지 않은 카드는 play할 수 없다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['9S']], ['영희', ['9D']]), '10S');
    const before = JSON.stringify(view(e, '철수'));
    expect(e.handleAction('철수', { name: 'play', arg: { card: 'AH' } })).toEqual([]);
    expect(JSON.stringify(view(e, '철수'))).toBe(before);
  });

  it('공격 스택이 있을 때 무효한 카드(같은 종류가 아님, 3 방어 없음)를 내면 거부된다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    // 철수에게 여분 카드(9S)를 줘서 2D를 내도 완주로 게임이 끝나버리지 않게 한다 —
    // 그래야 이어지는 영희의 시도가 "게임이 이미 끝나서 거부"가 아니라 정말
    // "3 방어가 없어서 거부"되는 것인지 검증할 수 있다.
    e.setHands(h(['철수', ['2D', '9S']], ['영희', ['3H']]), '2H');
    e.handleAction('철수', { name: 'play', arg: { card: '2D' } }); // 스택 2 걸림, 영희 턴
    expect(e.isFinished()).toBe(false);
    expect(view(e, '영희').attackStack).toBe(2);
    const before = JSON.stringify(view(e, '영희'));
    const events = e.handleAction('영희', { name: 'play', arg: { card: '3H' } });
    expect(events).toEqual([]);
    expect(JSON.stringify(view(e, '영희'))).toBe(before);
  });

  it('malformed arg는 모두 거부되고 상태가 불변이다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['9S']], ['영희', ['9D']]), '10S');
    const before = JSON.stringify(view(e, '철수'));
    expect(e.handleAction('철수', { name: 'play' })).toEqual([]);
    expect(e.handleAction('철수', { name: 'play', arg: null })).toEqual([]);
    expect(e.handleAction('철수', { name: 'play', arg: 'nope' })).toEqual([]);
    expect(e.handleAction('철수', { name: 'play', arg: {} })).toEqual([]);
    expect(e.handleAction('철수', { name: 'play', arg: { card: 42 } })).toEqual([]);
    expect(e.handleAction('철수', { name: 'nonsense-action' })).toEqual([]);
    expect(JSON.stringify(view(e, '철수'))).toBe(before);
  });

  it('opponents 손패 카드 문자열이 view의 어디에도 노출되지 않는다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    const myView = view(e, '철수');
    const opponentHand = (view(e, '영희').you as any).hand as Card[];
    const serialized = JSON.stringify(myView);
    for (const c of opponentHand) {
      expect(serialized.includes(`"${c}"`)).toBe(false);
    }
    // others 배열에는 카드 배열 자체가 없어야 한다 (닉네임/장수/isTurn만).
    const other = myView.others[0];
    expect(other).not.toHaveProperty('hand');
    expect(Object.keys(other).sort()).toEqual(['handCount', 'isTurn', 'nickname'].sort());
  });

  it('defaultAction은 자기 턴이면 언제나 draw이고, 여러 번 불러도 상태를 바꾸지 않는다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['9S']], ['영희', ['9D']]), '10S');
    const before = JSON.stringify(view(e, '철수'));
    expect(e.defaultAction('철수')).toEqual({ name: 'draw' });
    expect(e.defaultAction('철수')).toEqual({ name: 'draw' }); // 반복 호출도 안전
    expect(e.defaultAction('영희')).toBeNull(); // 영희 턴이 아니므로 null
    expect(JSON.stringify(view(e, '철수'))).toBe(before);
  });

  it('removePlayer로 이탈 시 턴이 정확히 다음 사람으로 넘어간다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
    e.setHands(h(['철수', ['9S']], ['영희', ['9D']], ['민수', ['9H']]), '10S');
    expect(e.pendingPlayers()).toEqual(['철수']);
    const events = e.removePlayer('철수');
    expect(events.length).toBeGreaterThan(0);
    expect(e.pendingPlayers()).toEqual(['영희']);
    expect(e.isFinished()).toBe(false);
  });

  it('removePlayer로 2명 중 1명이 이탈하면 즉시 게임이 끝나고 남은 사람이 랭킹에 오른다', () => {
    const e = new OneCardEngine();
    e.start(['철수', '영희'], '철수', mulberry32(1));
    const events = e.removePlayer('철수');
    expect(events.length).toBeGreaterThan(0);
    expect(e.isFinished()).toBe(true);
    expect(e.pendingPlayers()).toEqual([]);
    const result = e.result()!;
    expect(result.ranking.map((r) => r.nickname)).toEqual(['영희']);
  });
});

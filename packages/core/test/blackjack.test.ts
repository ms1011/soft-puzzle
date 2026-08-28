import { it, expect, describe } from 'vitest';
import { handValue, BlackjackEngine } from '../src/games/blackjack.js';
import { mulberry32 } from '../src/rng.js';

describe('handValue', () => {
  it.each([
    [['KH', '7D'], 17, false],
    [['AS', 'KD'], 21, true], // 블랙잭
    [['AS', 'AD', '9C'], 21, true],
    [['AS', 'AD', 'AC', '8H', 'KD'], 21, false], // A 전부 1
    [['KH', 'QD', '5S'], 25, false],
  ])('handValue(%j) = %i (soft=%s)', (cards, total, soft) => {
    expect(handValue(cards as string[])).toEqual({ total, soft });
  });
});

describe('BlackjackEngine', () => {
  function startGame(seed = 1) {
    const e = new BlackjackEngine();
    e.start(['철수', '영희'], '철수', mulberry32(seed));
    return e;
  }

  /**
   * 두 플레이어가 베팅하고, 각자의 턴에 순서대로 stand하여 settle까지 진행시킨다.
   * (주어진 세 번째 시나리오 테스트와 같은 방식: 명시적 순서로 stand를 호출한다.
   *  handleAction은 자기 턴이 아니면 무시되므로, 턴 순서와 무관하게 호출해도 안전하다.)
   */
  function advanceToSettle(
    e: BlackjackEngine,
    players: string[] = ['철수', '영희'],
    bets: number[] = [100, 50],
  ) {
    players.forEach((p, i) => e.handleAction(p, { name: 'bet', arg: bets[i] }));
    // 블랙잭으로 자동 스탠드된 플레이어에게 stand를 걸어도 무시되므로 순서대로 두 번 훑어준다.
    for (const p of players) e.handleAction(p, { name: 'stand' });
    for (const p of players) e.handleAction(p, { name: 'stand' });
    return e;
  }

  it('베팅 전원 완료 시 딜하고 acting으로 간다', () => {
    const e = startGame();
    expect(e.getViewFor('철수').phase).toBe('betting');
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    const v = e.getViewFor('철수');
    expect(v.phase).toBe('acting');
    expect((v.you as any).hand).toHaveLength(2);
    expect((v.dealer as any).hiddenCount).toBe(1);
  });

  it('내 턴이 아니면 액션이 무시된다', () => {
    const e = startGame();
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    const turnPlayer = e.pendingPlayers()[0];
    const other = turnPlayer === '철수' ? '영희' : '철수';
    const before = JSON.stringify(e.getViewFor(other));
    expect(e.handleAction(other, { name: 'hit' })).toEqual([]);
    expect(JSON.stringify(e.getViewFor(other))).toBe(before);
  });

  it('전원 스탠드 → 딜러 자동 진행 → settle에서 정산된다', () => {
    const e = startGame();
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    const v = e.getViewFor('철수');
    expect(v.phase).toBe('settle');
    expect((v.dealer as any).hiddenCount).toBe(0); // 전체 공개
    const chips = (v.you as any).chips;
    expect([900, 1000, 1100, 1150]).toContain(chips); // 패/무/승/블랙잭승
  });

  it('host의 endGame으로 종료되고 칩 순 랭킹이 나온다', () => {
    const e = startGame();
    advanceToSettle(e);
    expect(e.getViewFor('철수').phase).toBe('settle');
    expect(e.isFinished()).toBe(false);

    // host가 아닌 플레이어의 endGame은 무시된다.
    expect(e.handleAction('영희', { name: 'endGame' })).toEqual([]);
    expect(e.isFinished()).toBe(false);

    const events = e.handleAction('철수', { name: 'endGame' });
    expect(events.length).toBeGreaterThan(0);
    expect(e.isFinished()).toBe(true);

    const result = e.result();
    expect(result).not.toBeNull();
    const ranking = result!.ranking;
    expect(ranking).toHaveLength(2);
    expect(ranking.map((r) => r.nickname).sort()).toEqual(['영희', '철수']);
    ranking.forEach((r) => expect(r.detail).toMatch(/^칩 [\d,]+$/));
    const amounts = ranking.map((r) => Number(r.detail.replace(/[^0-9]/g, '')));
    expect(amounts[0]).toBeGreaterThanOrEqual(amounts[1]); // 칩 많은 순 정렬
  });

  it('베팅액이 칩을 초과하면 무시된다', () => {
    const e = startGame();
    const before = JSON.stringify(e.getViewFor('철수'));
    expect(e.handleAction('철수', { name: 'bet', arg: 5000 })).toEqual([]);
    expect(JSON.stringify(e.getViewFor('철수'))).toBe(before);
  });

  it('이탈 후 1명 남으면 즉시 종료', () => {
    const e = startGame();
    expect(e.isFinished()).toBe(false);
    const events = e.removePlayer('영희');
    expect(events.length).toBeGreaterThan(0);
    expect(e.isFinished()).toBe(true);
    expect(e.pendingPlayers()).toEqual([]);
  });

  // 아래 결정적 정산 케이스들은 seed 값을 미리 탐색해 원하는 패 조합이 나오는
  // 시드를 하드코딩한 것이다 (모두 seed=1로 시작하는 startGame, 철수 100 / 영희 50 베팅).
  // 시드별 실제 패 배분은 이 파일과 나란히 둔 탐색 스크립트로 확인했다.

  it('첫 2장에서만 double 가능, 더블다운은 베팅을 2배로 하고 한 장만 받은 뒤 자동 스탠드된다 (버스트 시 베팅 전액 상실)', () => {
    const e = startGame(1); // 철수: 9S,KS(19) / 영희: AS,QD(자연 블랙잭, 자동 스탠드)
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    expect(e.pendingPlayers()).toEqual(['철수']); // 영희는 블랙잭으로 이미 자동 스탠드

    const before = e.getViewFor('철수') as any;
    expect(before.yourActions).toEqual(['hit', 'stand', 'double']);
    expect(before.you.hand).toHaveLength(2);
    expect(before.you.chips).toBe(900); // 1000 - 100

    const events = e.handleAction('철수', { name: 'double' });
    expect(events.some((ev) => ev.text.includes('더블다운'))).toBe(true);
    expect(events.some((ev) => ev.text.includes('버스트'))).toBe(true); // 9+10+8=27

    // 철수가 유일한 acting 대상이었으므로 더블다운 직후 딜러 자동 진행 → settle까지 한번에 진행된다.
    const after = e.getViewFor('철수') as any;
    expect(after.phase).toBe('settle');
    expect(after.you.hand).toHaveLength(3); // 더블다운은 정확히 한 장만 더 받는다
    expect(after.you.bet).toBe(0); // 정산 후 베팅은 초기화된다
    expect(after.you.chips).toBe(800); // 900 - 100(더블다운 추가 베팅) - 버스트로 전액 상실
    const other = e.getViewFor('영희') as any;
    expect(other.you.chips).toBe(1075); // 950 + (50 + 50*1.5) 블랙잭 1.5배 승리
  });

  it('딜러 버스트 시 생존자 전원이 베팅만큼 승리한다', () => {
    const e = startGame(9);
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    const v = e.getViewFor('철수') as any;
    expect(v.phase).toBe('settle');
    expect(handValue(v.dealer.hand as string[]).total).toBeGreaterThan(21);
    expect(v.you.chips).toBe(1100); // 900 + 100*2
    expect((e.getViewFor('영희') as any).you.chips).toBe(1050); // 950 + 50*2
  });

  it('숫자가 같으면 푸시로 베팅을 돌려받는다', () => {
    const e = startGame(42);
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    const v = e.getViewFor('철수') as any;
    expect(v.phase).toBe('settle');
    const chulsooTotal = handValue(v.you.hand as string[]).total;
    const dealerTotal = handValue(v.dealer.hand as string[]).total;
    expect(chulsooTotal).toBe(dealerTotal); // 8C,9S(17) vs JD,7S(17)
    expect(v.you.chips).toBe(1000); // 900 + 100 (베팅 반환, 이득 없음)
  });

  it('딜러가 블랙잭이면 자연 블랙잭이 아닌 플레이어는 전원 패배한다', () => {
    const e = startGame(16); // 딜러: 10H,AS(자연 블랙잭) / 철수·영희 모두 블랙잭 아님
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    const v = e.getViewFor('철수') as any;
    expect(v.phase).toBe('settle');
    expect(v.dealer.hand).toHaveLength(2);
    expect(handValue(v.dealer.hand as string[])).toEqual({ total: 21, soft: true });
    expect(v.you.chips).toBe(900); // 베팅 전액 상실, 반환 없음
    expect((e.getViewFor('영희') as any).you.chips).toBe(950);
  });

  it('acting 중 현재 턴 플레이어가 이탈하면 다음 사람의 턴을 건너뛰지 않는다', () => {
    const e = new BlackjackEngine();
    e.start(['철수', '영희', '민수'], '철수', mulberry32(1));
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    e.handleAction('민수', { name: 'bet', arg: 50 });
    expect(e.pendingPlayers()).toEqual(['철수']); // 철수 턴에서 시작

    const events = e.removePlayer('철수'); // 철수가 자기 턴에 이탈
    expect(events.length).toBeGreaterThan(0);
    // 영희(원래 두 번째 순서)의 턴으로 넘어가야 한다 — 민수로 건너뛰면 버그.
    expect(e.pendingPlayers()).toEqual(['영희']);
  });

  it('플레이어와 딜러 모두 블랙잭이면 푸시, 플레이어만 블랙잭이면 1.5배 승리한다', () => {
    const e = startGame(708); // 철수: AS,JC(블랙잭) / 딜러: AD,10H(블랙잭) / 영희: KH,5D(블랙잭 아님)
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    // 철수·영희 모두 첫 2장이 블랙잭이거나(자동 스탠드) 순서대로 stand하면 정산까지 진행된다.
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    const v = e.getViewFor('철수') as any;
    expect(v.phase).toBe('settle');
    expect(handValue(v.you.hand as string[])).toEqual({ total: 21, soft: true });
    expect(handValue(v.dealer.hand as string[])).toEqual({ total: 21, soft: true });
    expect(v.you.chips).toBe(1000); // 둘 다 블랙잭 → 푸시 (900 + 100)
    expect((e.getViewFor('영희') as any).you.chips).toBe(950); // 블랙잭 아님, 딜러 블랙잭에 패배
  });
});

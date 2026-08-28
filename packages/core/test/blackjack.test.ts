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
    const v = e.getViewFor('철수') as any;
    expect(v.phase).toBe('settle');
    expect((v.dealer as any).hiddenCount).toBe(0); // 전체 공개
    // seed=1, 더블 없이 스탠드만 하면: 철수 9S,KS(19) vs 딜러 7D,4H,8S(19) → 푸시.
    // (막연히 "4가지 값 중 하나"로만 검증하면 정산 로직이 깨져도 통과하므로,
    // 실제 시드로 나오는 정확한 결과값으로 검증한다.)
    expect(handValue(v.you.hand as string[])).toEqual({ total: 19, soft: false });
    expect(handValue(v.dealer.hand as string[])).toEqual({ total: 19, soft: false });
    expect(v.you.chips).toBe(1000); // 900 + 100 (푸시, 베팅 반환)
    expect((e.getViewFor('영희') as any).you.chips).toBe(1075); // 자연 블랙잭 1.5배 승리
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

  it('내추럴 없이 딜러가 스탠드하면 숫자가 큰 쪽이 이기고 작은 쪽이 진다', () => {
    const e = startGame(13); // 철수: 8H,AD(19) vs 딜러: AC,AS,2S,4C(18) → 승 / 영희: 5D,AH(16) → 패
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
    const v = e.getViewFor('철수') as any;
    expect(v.phase).toBe('settle');
    const dealerTotal = handValue(v.dealer.hand as string[]).total;
    expect(dealerTotal).toBeLessThanOrEqual(21);
    expect(handValue(v.you.hand as string[])).toEqual({ total: 19, soft: true });
    expect(dealerTotal).toBe(18);
    expect(v.you.chips).toBe(1100); // 19 > 18 → 900 + 100*2 (평범한 승리)
    const other = e.getViewFor('영희') as any;
    expect(handValue(other.you.hand as string[])).toEqual({ total: 16, soft: true });
    expect(other.you.chips).toBe(950); // 16 < 18 → 베팅 상실 (평범한 패배)
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

  describe('defaultAction', () => {
    it('betting에서는 아직 베팅하지 않은 대기 플레이어에게 bet 10을 반환한다', () => {
      const e = startGame();
      expect(e.defaultAction('철수')).toEqual({ name: 'bet', arg: 10 });
    });

    it('acting에서는 현재 턴 플레이어에게 stand를, 아닌 플레이어에게 null을 반환한다', () => {
      const e = startGame();
      e.handleAction('철수', { name: 'bet', arg: 100 });
      e.handleAction('영희', { name: 'bet', arg: 50 });
      const turn = e.pendingPlayers()[0];
      const other = turn === '철수' ? '영희' : '철수';
      expect(e.defaultAction(turn)).toEqual({ name: 'stand' });
      expect(e.defaultAction(other)).toBeNull(); // 자기 턴이 아니면 적용할 게 없다
    });

    it('settle에서는 아직 준비하지 않은 플레이어에게 ready를, 이미 준비했으면 null을 반환한다', () => {
      const e = startGame();
      advanceToSettle(e);
      expect(e.getViewFor('철수').phase).toBe('settle');
      expect(e.defaultAction('철수')).toEqual({ name: 'ready' });
      e.handleAction('철수', { name: 'ready' });
      expect(e.defaultAction('철수')).toBeNull(); // 이미 준비 완료 → 더 적용할 게 없다
    });

    it('betting에서 이미 베팅을 마친 플레이어에게는 null을 반환한다', () => {
      const e = startGame();
      e.handleAction('철수', { name: 'bet', arg: 100 });
      expect(e.defaultAction('철수')).toBeNull();
    });

    it('순수 조회다 — 몇 번을 호출해도 엔진 상태를 바꾸지 않는다', () => {
      const e = startGame();
      const before = JSON.stringify(e.getViewFor('철수'));
      e.defaultAction('철수'); // betting: 아직 베팅 전
      e.defaultAction('철수'); // 두 번 호출해도(Room이 힌트 표시용으로 먼저 조회하는 경우 등)
      expect(JSON.stringify(e.getViewFor('철수'))).toBe(before);
      expect(e.pendingPlayers()).toEqual(['철수', '영희']); // 아무도 관전 전환되지 않았다

      // acting에서도 동일하게 순수해야 한다.
      e.handleAction('철수', { name: 'bet', arg: 100 });
      e.handleAction('영희', { name: 'bet', arg: 50 });
      const turn = e.pendingPlayers()[0];
      const beforeActing = JSON.stringify(e.getViewFor(turn));
      e.defaultAction(turn);
      e.defaultAction(turn);
      expect(JSON.stringify(e.getViewFor(turn))).toBe(beforeActing);
    });
  });

  describe('베팅 불가능한 저칩 플레이어와 교착 상태 방지', () => {
    it('전원이 파산하면 betting에 pendingPlayers 없이 멈추지 않고 settle로 돌아가 host가 endGame으로 끝낼 수 있다', () => {
      const e = startGame(2); // seed 2: 철수 17 vs 딜러 18(패), 영희 15 vs 딜러 18(패) — 올인하면 둘 다 파산
      e.handleAction('철수', { name: 'bet', arg: 1000 }); // 전 재산 올인
      e.handleAction('영희', { name: 'bet', arg: 1000 });
      for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });
      for (const p of ['철수', '영희']) e.handleAction(p, { name: 'stand' });

      let v = e.getViewFor('철수') as any;
      expect(v.phase).toBe('settle');
      expect(v.you.chips).toBe(0); // 완패, 전 재산 상실
      expect((e.getViewFor('영희') as any).you.chips).toBe(0);

      // 전원 준비 완료 → beginBettingRound가 "전원 관전(칩 0 < MIN_BET)"을 감지하고
      // betting에 pendingPlayers 없이 멈추는 대신 곧장 dealRound를 거쳐 settle로 되돌아가야 한다.
      e.handleAction('철수', { name: 'ready' });
      // 아직 영희가 준비하지 않았으니 이 시점엔 정상적으로 settle에서 영희를 기다리는 중이어야 한다.
      expect(e.getViewFor('철수').phase).toBe('settle');
      expect(e.pendingPlayers()).toEqual(['영희']);

      const secondReady = e.handleAction('영희', { name: 'ready' });
      expect(secondReady.length).toBeGreaterThan(0);

      expect(e.isFinished()).toBe(false);
      // 결정적인 교착 상태 불변식: betting 단계인데 아무도 pending이 아니면 그건 멈춘 것이다.
      expect(!(e.getViewFor('철수').phase === 'betting' && e.pendingPlayers().length === 0)).toBe(true);
      // 실제로는 settle로 돌아가 있어야 하고, 거기서는 항상 누군가 pending이거나 host가 끝낼 수 있다.
      expect(e.getViewFor('철수').phase).toBe('settle');
      expect(e.pendingPlayers().length).toBeGreaterThan(0); // ready 대기 중 — 멈추지 않았다

      // host가 여기서 게임을 끝낼 수 있다 (설계상 게임은 오직 host의 endGame으로만 끝난다).
      const endEvents = e.handleAction('철수', { name: 'endGame' });
      expect(endEvents.length).toBeGreaterThan(0);
      expect(e.isFinished()).toBe(true);
      const ranking = e.result()!.ranking;
      expect(ranking).toHaveLength(2);
      expect(ranking.every((r) => r.detail === '칩 0')).toBe(true);
    });

    it('베팅 미만(1~9칩)인 플레이어는 라운드 시작 시 자동 관전되어 나머지 인원의 베팅을 막지 않는다', () => {
      // defaultAction의 관전 전환 부작용을 제거했으므로, 관전 판정은 beginBettingRound에서
      // chips < MIN_BET(10) 기준으로 라운드 시작 시 한 번만 이뤄져야 한다.
      //
      // 순수 게임 진행만으로 1~9칩 상태를 만들려면(정수 베팅은 항상 10의 배수이므로 완패는
      // 항상 정확히 0을 남긴다) 블랙잭 1.5배 배당의 나머지를 여러 라운드에 걸쳐 쌓아야 해서
      // beginBettingRound 자체의 판정과는 무관하게 시드 탐색만 복잡해진다. 그래서 이 유닛은
      // 저칩 상태를 직접 구성해 beginBettingRound의 임계값 판정만 독립적으로 검증한다
      // (draw()의 덱 소진 방지 테스트와 같은 방식으로, private 내부 상태에 의도적으로 접근한다).
      const e = startGame();
      const anyE = e as any;
      anyE.seats.get('철수').chips = 5; // 최소 베팅(10) 미만이지만 0은 아님
      const events: unknown[] = anyE.beginBettingRound();
      expect(events).toEqual([]); // 영희는 정상 베팅 가능하므로 "전원 관전"은 아니다 — betting에 머무른다

      const v = e.getViewFor('철수') as any;
      expect(v.phase).toBe('betting');
      expect(v.you.chips).toBe(5);
      expect(v.you.spectating).toBe(true); // 5 < MIN_BET(10) → 자동 관전
      expect(v.yourActions).toEqual([]); // 관전 중이므로 액션 없음
      expect(e.pendingPlayers()).toEqual(['영희']); // 철수는 대기 목록에서 제외되어 영희만 베팅하면 된다

      const betEvents = e.handleAction('영희', { name: 'bet', arg: 50 });
      expect(betEvents.length).toBeGreaterThan(0);
      expect((e.getViewFor('영희') as any).phase).toBe('acting'); // 철수 없이도 라운드가 정상 진행된다
    });
  });

  it('덱이 바닥나면 이미 테이블에 나가 있는 카드를 제외하고 다시 채운다 (중복 카드 방지)', () => {
    // draw()는 private이므로, 소진 상황을 직접 재현하기 위해 내부 상태에 잠깐 손을 댄다.
    //
    // 한 장만 뽑아 "테이블 위 카드와 겹치지 않는지" 확인하면, 버그가 있는 구현이라도
    // 52장 중 우연히 안 겹치는 카드를 뽑을 확률이 높아(테이블 위 카드는 소수) 그 시도만으로는
    // 실제로 버그를 잡지 못할 수 있다. 대신 소진 직후 정확히 52장을 뽑는다: 버그가 있는
    // 구현은 테이블 위 카드까지 포함한 "완전한" 52장 덱을 다시 섞으므로 52장을 모두 뽑으면
    // 테이블 위 카드가 반드시(비둘기집 원리) 한 번은 다시 나온다. 고친 구현은 테이블 위
    // 카드를 제외하고 다시 채우므로, 몇 번을 다시 채우든 52장을 뽑는 동안 절대 나오지 않는다.
    const e = startGame();
    e.handleAction('철수', { name: 'bet', arg: 100 });
    e.handleAction('영희', { name: 'bet', arg: 50 });
    const anyE = e as any;
    const inPlay = new Set<string>(anyE.dealerHand as string[]);
    for (const seat of anyE.seats.values()) {
      for (const c of seat.hand as string[]) inPlay.add(c);
    }
    expect(inPlay.size).toBeGreaterThan(0);
    anyE.deck = []; // 셔플 더미를 강제로 소진 상태로 만든다

    const drawnCards: string[] = [];
    for (let i = 0; i < 52; i++) drawnCards.push(anyE.draw());

    const collisions = drawnCards.filter((c) => inPlay.has(c));
    expect(collisions).toEqual([]); // 이미 테이블 위에 있는 카드와 중복되면 안 된다
  });
});

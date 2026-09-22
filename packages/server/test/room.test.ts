import { describe, it, expect } from 'vitest';
import { Room } from '../src/room.js';
import { mulberry32, TURN_TIMEOUT_MS, MAX_PLAYERS } from '@soft-puzzle/core';
import type { ServerMsg, GameId, MafiaSettings } from '@soft-puzzle/core';

type StateMsg = Extract<ServerMsg, { type: 'state' }>;
type EventMsg = Extract<ServerMsg, { type: 'event' }>;

function setup(opts?: { game?: GameId; host?: string; seed?: number; name?: string; mafiaSettings?: MafiaSettings }) {
  let t = 0;
  const room = new Room({
    name: opts?.name ?? '철수의 방',
    game: opts?.game ?? 'blackjack',
    host: opts?.host ?? '철수',
    rng: mulberry32(opts?.seed ?? 7),
    now: () => t,
    mafiaSettings: opts?.mafiaSettings,
  });
  const sent: Record<string, ServerMsg[]> = {};
  room.onSend((nick, msg) => {
    (sent[nick] ??= []).push(msg);
  });
  return {
    room,
    sent,
    tick: (ms: number) => {
      t += ms;
      room.checkTimeout();
    },
  };
}

function lastState(msgs: ServerMsg[] | undefined): StateMsg {
  const states = (msgs ?? []).filter((m): m is StateMsg => m.type === 'state');
  if (states.length === 0) throw new Error('no state messages received');
  return states[states.length - 1];
}

function events(msgs: ServerMsg[] | undefined): EventMsg[] {
  return (msgs ?? []).filter((m): m is EventMsg => m.type === 'event');
}

/** 2인 블랙잭을 베팅 → (필요시) 액션까지 진행시켜 settle 단계로 보낸다. */
function advanceToSettle(room: Room, players: string[], bets: number[]) {
  players.forEach((p, i) => room.handleMessage(p, { type: 'action', name: 'bet', arg: bets[i] }));
  // 자연 블랙잭으로 자동 완료된 사람에게 stand를 걸어도 엔진이 무시하므로, 순서 상관없이
  // 두 차례 훑어주면 전원이 acting을 끝내고 settle에 도달한다(core의 자체 테스트와 동일한 패턴).
  for (const p of players) room.handleMessage(p, { type: 'action', name: 'stand' });
  for (const p of players) room.handleMessage(p, { type: 'action', name: 'stand' });
}

describe('Room — lobby', () => {
  it('마피아 수가 현재 참가자의 절반 이상이면 방장이 시작할 수 없다', () => {
    const { room, sent } = setup({ game: 'mafia', mafiaSettings: { mafiaCount: 2, specialRoles: [] } });
    expect(room.join('철수')).toEqual({ ok: true });
    expect(room.join('영희')).toEqual({ ok: true });
    expect(room.join('민수')).toEqual({ ok: true });
    expect(room.join('지수')).toEqual({ ok: true });

    room.handleMessage('철수', { type: 'action', name: 'start' });

    expect(lastState(sent['철수']).phase).toBe('lobby');
    expect(events(sent['철수']).at(-1)?.text).toContain('절반 미만');
  });

  it('① join 후 전원이 lobby state를 받는다', () => {
    const { room, sent } = setup();
    expect(room.join('철수')).toEqual({ ok: true });
    expect(room.join('영희')).toEqual({ ok: true });

    const s1 = lastState(sent['철수']);
    const s2 = lastState(sent['영희']);
    expect(s1.phase).toBe('lobby');
    expect(s2.phase).toBe('lobby');
    expect(s1.room.players).toEqual(['철수', '영희']);
    expect(s2.room.players).toEqual(['철수', '영희']);
    expect(s1.room.host).toBe('철수');
  });

  it('지정된 host보다 다른 사람이 먼저 join해도 host 자리를 가로채지 않는다(회귀 방지)', () => {
    // Room 생성 시점에는 host(철수)가 아직 join하지 않은 상태다 — 이 상태와 "방이 완전히
    // 비었다가 다시 채워지는" 상태를 host 재할당 로직이 반드시 구분해야 한다.
    const { room, sent } = setup(); // host 지정: '철수' (아직 join 전)
    expect(room.join('영희')).toEqual({ ok: true }); // 철수보다 영희가 먼저 들어온다
    expect(lastState(sent['영희']).room.host).toBe('철수'); // 영희가 host를 가로채지 않았다

    // 영희는 host가 아니므로 start를 시도해도 거부된다 — 영희가 잠깐이라도 host였던 적이
    // 없음을 사전에 확인한다.
    room.handleMessage('영희', { type: 'action', name: 'start' });
    expect(lastState(sent['영희']).phase).toBe('lobby');
    const evs = events(sent['영희']);
    expect(evs[evs.length - 1].text).toContain('방장');

    // 지정된 host(철수)가 뒤늦게 들어와도 host 지위는 여전히 철수의 것이다.
    expect(room.join('철수')).toEqual({ ok: true });
    expect(lastState(sent['철수']).room.host).toBe('철수');

    // 철수의 start는 정상적으로(방장 자격으로) 받아들여진다.
    room.handleMessage('철수', { type: 'action', name: 'start' });
    expect(lastState(sent['철수']).phase).toBe('playing');
  });

  it('빈 닉네임은 거부된다', () => {
    const { room } = setup();
    expect(room.join('')).toEqual({ ok: false, code: 'dup' });
  });

  it('공백만으로 된 닉네임은 거부된다', () => {
    const { room } = setup();
    expect(room.join('   ')).toEqual({ ok: false, code: 'dup' });
    expect(room.join('\t\n')).toEqual({ ok: false, code: 'dup' });
  });

  it('너무 긴 닉네임은 거부된다', () => {
    const { room } = setup();
    expect(room.join('a'.repeat(33))).toEqual({ ok: false, code: 'dup' });
    expect(room.join('a'.repeat(32))).toEqual({ ok: true }); // 경계값은 허용된다
  });

  it('앞뒤 공백이 있는 닉네임은 정리(trim)되어 저장된다', () => {
    const { room, sent } = setup();
    expect(room.join('  철수  ')).toEqual({ ok: true });
    expect(lastState(sent['철수']).room.players).toEqual(['철수']); // 공백 없이 저장됨

    // leave()/handleMessage()도 같은 방식으로 정리하므로, 원래 넘겼던(공백 포함) 닉네임으로도
    // 정상적으로 이 플레이어를 가리킬 수 있다 — 저장된 값과 어긋나 "방에 없는 사람"으로
    // 취급되지 않는다.
    room.handleMessage('  철수  ', { type: 'action', name: 'start' });
    // (혼자라 minPlayers 미달로 거부되지만, "방에 없는 사람"으로 무시된 게 아니라 인원 부족
    // 사유가 정상적으로 안내된다는 점이 중요하다.)
    const evs = events(sent['철수']);
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[evs.length - 1].text).toContain('명이 있어야');
  });

  it('② 7번째 join은 {ok:false, code:"full"}', () => {
    const { room } = setup();
    for (let i = 0; i < MAX_PLAYERS; i++) {
      expect(room.join(`p${i}`)).toEqual({ ok: true });
    }
    expect(room.join('p6')).toEqual({ ok: false, code: 'full' });
  });

  it('③ 닉네임 중복은 {ok:false, code:"dup"}', () => {
    const { room } = setup();
    room.join('철수');
    expect(room.join('철수')).toEqual({ ok: false, code: 'dup' });
  });

  it('게임이 시작된 뒤 join은 {ok:false, code:"playing", phase:"playing"}', () => {
    const { room } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });
    expect(room.join('민수')).toEqual({ ok: false, code: 'playing', phase: 'playing' });
  });

  it(
    'result 화면(스코어보드)이 떠 있는 동안의 join도 여전히 code:"playing"이지만 ' +
      'phase:"result"를 함께 실어 보낸다(중요사항 2 — server.ts가 이걸로 문구를 구분한다)',
    () => {
      const { room } = setup();
      room.join('철수');
      room.join('영희');
      room.handleMessage('철수', { type: 'action', name: 'start' });
      advanceToSettle(room, ['철수', '영희'], [100, 50]);
      room.handleMessage('철수', { type: 'action', name: 'endGame' });

      expect(room.join('민수')).toEqual({ ok: false, code: 'playing', phase: 'result' });
    },
  );

  it('④ host가 아닌 사람의 start는 무시되고, 그 사람에게만 사유가 안내된다', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('영희', { type: 'action', name: 'start' });

    expect(lastState(sent['영희']).phase).toBe('lobby');
    const evs = events(sent['영희']);
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[evs.length - 1].text).toContain('방장');
    // 다른 사람에게는 사유 안내가 가지 않는다
    expect(events(sent['철수']).length).toBe(0);
  });

  it('인원이 minPlayers 미만이면 host의 start도 무시되고 사유가 안내된다', () => {
    const { room, sent } = setup(); // blackjack: minPlayers=2
    room.join('철수');
    room.handleMessage('철수', { type: 'action', name: 'start' });

    expect(lastState(sent['철수']).phase).toBe('lobby');
    const evs = events(sent['철수']);
    expect(evs.length).toBeGreaterThan(0);
  });

  it('leave: lobby에서는 명단에서 제거되고 남은 인원에게 상태가 브로드캐스트된다', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.join('영희');
    room.leave('영희');
    expect(lastState(sent['철수']).room.players).toEqual(['철수']);
  });
});

describe('Room — playing/turn timer', () => {
  it('시작 후 각자 받은 state.view가 다르다 — 정보 격리(블랙잭: 내 hand만 카드, 상대는 handCount)', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });

    const v1 = lastState(sent['철수']).view as any;
    const v2 = lastState(sent['영희']).view as any;
    expect(v1.you.hand.length).toBe(0); // betting 단계라 아직 카드 없음(문서화된 동작)
    expect(v1.phase).toBe('betting');
    expect(v2.phase).toBe('betting');

    room.handleMessage('철수', { type: 'action', name: 'bet', arg: 100 });
    room.handleMessage('영희', { type: 'action', name: 'bet', arg: 50 });

    const w1 = lastState(sent['철수']).view as any;
    const w2 = lastState(sent['영희']).view as any;
    expect(w1.you.hand.length).toBe(2);
    expect(w2.you.hand.length).toBe(2);
    // 서로 상대의 hand 카드 배열은 볼 수 없고 handCount만 볼 수 있다(블랙잭은 원래 공개 게임이라
    // others[].hand 자체는 존재하지만, 그것과 별개로 각자의 view.you는 반드시 자기 자신 기준이다).
    expect(w1.others[0].nickname).toBe('영희');
    expect(w1.others[0].handCount).toBe(2);
    expect(w1.you.hand).not.toEqual(w2.you.hand);
  });

  it('⑤ 원카드 방에서는 상대 카드 문자열이 state·event 어디에도 유출되지 않는다', () => {
    const { room, sent } = setup({ game: 'onecard', seed: 3 });
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });

    // 항상 유효한 draw만 번갈아 호출해 이벤트/상태 메시지를 여러 번 만든다(turn 순서: 철수→영희).
    for (let i = 0; i < 4; i++) {
      room.handleMessage('철수', { type: 'action', name: 'draw' });
      room.handleMessage('영희', { type: 'action', name: 'draw' });
    }

    const younghuiHand = (lastState(sent['영희']).view as any).you.hand as string[];
    expect(younghuiHand.length).toBeGreaterThan(0);

    const cheolsuMessages = JSON.stringify(sent['철수']);
    for (const card of younghuiHand) {
      expect(cheolsuMessages).not.toContain(`"${card}"`);
    }

    const cheolsuHand = (lastState(sent['철수']).view as any).you.hand as string[];
    const younghuiMessages = JSON.stringify(sent['영희']);
    for (const card of cheolsuHand) {
      expect(younghuiMessages).not.toContain(`"${card}"`);
    }
  });

  it('⑥ fake clock을 90초 넘겨 checkTimeout()을 호출하면 자동 처리 event가 나간다', () => {
    const { room, sent, tick } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });

    expect(lastState(sent['철수']).deadline).toBe(TURN_TIMEOUT_MS);

    tick(TURN_TIMEOUT_MS + 1);

    const evs = events(sent['철수']).map((e) => e.text);
    expect(evs.some((t) => t.includes('시간 초과'))).toBe(true);
    // betting 단계에서 자동 최소 베팅이 적용되었어야 한다
    const view = lastState(sent['철수']).view as any;
    expect(view.you.bet).toBeGreaterThan(0);
    expect(lastState(sent['철수']).deadline).toBe(TURN_TIMEOUT_MS * 2 + 1);
  });

  it('checkTimeout은 데드라인 전에는 아무 것도 하지 않는다', () => {
    const { room, sent, tick } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });
    tick(TURN_TIMEOUT_MS - 1);
    expect(events(sent['철수']).some((e) => e.text.includes('시간 초과'))).toBe(false);
  });

  it('checkTimeout은 lobby/result 단계 및 게임이 없을 때도 안전하다', () => {
    const { room, sent, tick } = setup();
    room.join('철수');
    expect(() => tick(TURN_TIMEOUT_MS + 1)).not.toThrow();
    expect(events(sent['철수']).length).toBe(0);
  });

  it('⑦ 게임 종료 시 result state가 전달되고, host의 replay로 다시 playing이 된다', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });
    advanceToSettle(room, ['철수', '영희'], [100, 50]);

    room.handleMessage('철수', { type: 'action', name: 'endGame' });
    const resultState = lastState(sent['철수']);
    expect(resultState.phase).toBe('result');
    expect(resultState.result).toBeDefined();
    expect(resultState.result!.ranking.length).toBe(2);

    room.handleMessage('철수', { type: 'action', name: 'replay' });
    expect(lastState(sent['철수']).phase).toBe('playing');
    expect(lastState(sent['철수']).room.host).toBe('철수');
  });

  it('result에서 host의 toLobby로 phase가 lobby로 돌아간다', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });
    advanceToSettle(room, ['철수', '영희'], [100, 50]);
    room.handleMessage('철수', { type: 'action', name: 'endGame' });
    expect(lastState(sent['철수']).phase).toBe('result');

    room.handleMessage('철수', { type: 'action', name: 'toLobby' });
    expect(lastState(sent['철수']).phase).toBe('lobby');
  });

  it('무효 액션은 상태를 변경하지 않는다', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });
    const before = JSON.stringify(lastState(sent['철수']));
    const beforeCount = (sent['철수'] ?? []).length;

    room.handleMessage('철수', { type: 'action', name: 'bet', arg: -5 }); // 유효하지 않은 베팅

    expect(JSON.stringify(lastState(sent['철수']))).toBe(before);
    expect((sent['철수'] ?? []).length).toBe(beforeCount); // 새 메시지가 아예 안 나갔다
  });

  it('방에 없는 사람이 보낸 액션은 무시되고 상태를 바꾸지 않는다', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });
    const before = JSON.stringify(lastState(sent['철수']));

    expect(() => room.handleMessage('침입자', { type: 'action', name: 'bet', arg: 100 })).not.toThrow();

    expect(JSON.stringify(lastState(sent['철수']))).toBe(before);
    expect(sent['침입자']).toBeUndefined();
  });

  it('알 수 없는/기형 메시지를 받아도 예외 없이 무시한다', () => {
    const { room } = setup();
    room.join('철수');
    expect(() => room.handleMessage('철수', null as unknown as never)).not.toThrow();
    expect(() => room.handleMessage('철수', {} as unknown as never)).not.toThrow();
    expect(() => room.handleMessage('철수', { type: 'action' } as unknown as never)).not.toThrow();
    expect(() => room.handleMessage('철수', { type: 'unknown-type' } as unknown as never)).not.toThrow();
    expect(() => room.handleMessage('없는사람', { type: 'chat', text: 'hi' })).not.toThrow();
  });

  it('chat은 "[닉네임] 텍스트" 형식의 event로 전원에게 브로드캐스트된다', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'chat', text: 'ㄱㄱ' });

    const ev = events(sent['영희']);
    expect(ev[ev.length - 1].text).toBe('[철수] ㄱㄱ');
    const evSelf = events(sent['철수']);
    expect(evSelf[evSelf.length - 1].text).toBe('[철수] ㄱㄱ');
  });

  it('leave: playing 중 이탈(host 아님)하면 engine 이벤트와 새 state가 브로드캐스트되고 게임은 계속된다', () => {
    const { room, sent } = setup({ game: 'onecard' });
    room.join('철수');
    room.join('영희');
    room.join('민수');
    room.handleMessage('철수', { type: 'action', name: 'start' });

    room.leave('민수');

    const evs = events(sent['철수']).map((e) => e.text);
    expect(evs.some((t) => t.includes('민수') && t.includes('떠났습니다'))).toBe(true);
    expect(lastState(sent['철수']).room.players).toEqual(['철수', '영희']);
    expect(lastState(sent['철수']).phase).toBe('playing');
  });
});

describe('Room — info()', () => {
  it(`info()는 "n/${MAX_PLAYERS}" 형식의 인원수를 보고한다`, () => {
    const { room } = setup({ name: '영희의 방' });
    room.join('철수');
    room.join('영희');
    const info = room.info();
    expect(info.room).toBe('영희의 방');
    expect(info.game).toBe('blackjack');
    expect(info.players).toBe(`2/${MAX_PLAYERS}`);
  });
});

describe('Room — host 재할당(host 이탈이 방을 좌초시키지 않아야 한다)', () => {
  it(
    'host가 게임 중 이탈하면 가장 오래 남아있는 플레이어가 새 host가 되지만, ' +
      '혼자 남았다면 그 사람의 replay는 minPlayers 미달로 막힌다(중요사항 4)',
    () => {
      const { room, sent } = setup();
      room.join('철수'); // host
      room.join('영희');
      room.handleMessage('철수', { type: 'action', name: 'start' });
      advanceToSettle(room, ['철수', '영희'], [100, 50]);
      expect((lastState(sent['영희']).view as any).phase).toBe('settle');

      // host(철수)가 이탈 — 2명 중 1명만 남으므로 블랙잭 엔진이 스스로 게임을 종료 처리한다.
      room.leave('철수');

      const evs = events(sent['영희']).map((e) => e.text);
      expect(evs.some((t) => t.includes('철수') && t.includes('떠났습니다'))).toBe(true);
      expect(evs.some((t) => t.includes('영희') && t.includes('방장'))).toBe(true);

      const state = lastState(sent['영희']);
      expect(state.room.host).toBe('영희');
      expect(state.room.players).toEqual(['영희']);
      expect(state.phase).toBe('result');

      // 새 host(영희)는 혼자다 — replay가 tryStart와 같은 minPlayers guard에 막혀야 한다
      // (예전에는 여기서 솔로 블랙잭이 조용히 새로 시작됐다 — 리뷰에서 발견된 결함).
      const beforeCount = (sent['영희'] ?? []).length;
      room.handleMessage('영희', { type: 'action', name: 'replay' });
      const afterEvs = events(sent['영희']).map((e) => e.text);
      expect(afterEvs[afterEvs.length - 1]).toContain('최소');
      expect((sent['영희'] ?? []).length).toBe(beforeCount + 1); // event 하나만 추가되고 state는 안 나간다
      expect(lastState(sent['영희']).phase).toBe('result'); // 여전히 result에 머문다
    },
  );

  it('host가 자신의 턴 도중 이탈해도 예외 없이 처리되고 게임이 스스로 종료된다', () => {
    const { room, sent } = setup();
    room.join('철수'); // host
    room.join('영희');
    room.handleMessage('철수', { type: 'action', name: 'start' });
    room.handleMessage('철수', { type: 'action', name: 'bet', arg: 100 });
    room.handleMessage('영희', { type: 'action', name: 'bet', arg: 50 });

    let v = lastState(sent['철수']).view as any;
    // 이 테스트가 실제로 노리는 상태(acting 단계, 곧 철수 자신의 턴)를 명시적으로 확인한다 —
    // 시드나 엔진이 바뀌어 둘 다 자연 블랙잭이 되는 등으로 전제가 깨지면 조용히 통과하는 대신
    // 여기서 바로 실패해야 한다.
    expect(v.phase).toBe('acting');
    if (v.others[0].isTurn) {
      // 영희 턴이 먼저라면 stand로 넘겨 철수 턴으로 만든다.
      room.handleMessage('영희', { type: 'action', name: 'stand' });
      v = lastState(sent['철수']).view as any;
    }
    expect(v.phase).toBe('acting');
    expect(v.others[0].isTurn).toBe(false); // 2인전이므로 영희 턴이 아니면 지금은 철수 자신의 턴이다

    expect(() => room.leave('철수')).not.toThrow(); // 자신의 턴 도중 host 이탈

    // 2명 중 1명만 남았으므로 엔진이 스스로 게임을 종료 처리하고, 새 host(영희)가 정상적으로 안내된다.
    expect(lastState(sent['영희']).room.host).toBe('영희');
    expect(lastState(sent['영희']).phase).toBe('result');
  });

  it('남은 플레이어가 2명 이상이어도, 승격된 새 host의 endGame이 이미 실행 중인 엔진에 받아들여진다', () => {
    const { room, sent } = setup();
    room.join('철수'); // host
    room.join('영희');
    room.join('민수');
    room.handleMessage('철수', { type: 'action', name: 'start' });
    advanceToSettle(room, ['철수', '영희', '민수'], [100, 50, 50]);
    expect((lastState(sent['영희']).view as any).phase).toBe('settle');

    room.leave('철수'); // host 이탈, 2명(영희·민수) 남아 게임은 계속된다.

    const afterLeave = lastState(sent['영희']);
    expect(afterLeave.room.host).toBe('영희'); // Room 차원에서 재할당됨
    expect(afterLeave.phase).toBe('playing'); // 아직 진행 중(2명 남음, order.length>1)
    // setHost의 두 번째 관측 가능한 효과: getViewFor 경로(yourActions)도 새 host를 인정해야
    // 클라이언트가 endGame 버튼을 실제로 보여줄 수 있다 — 게이트(handleAction)만 통과하고
    // 액션 목록에는 반영이 안 되는 반쪽짜리 수정이 아님을 확인한다.
    expect((afterLeave.view as any).yourActions).toContain('endGame');

    room.handleMessage('영희', { type: 'action', name: 'endGame' });

    // Room이 host 재할당과 동시에 engine.setHost(새 host)를 호출하므로, 이미 실행 중이던
    // 엔진도 새 host를 인정한다 — 승격된 host의 endGame이 이제 받아들여진다.
    const finalState = lastState(sent['영희']);
    expect(finalState.phase).toBe('result');
    expect(finalState.result).toBeDefined();
  });

  it(
    'Task 4 시나리오 전체: 원래 host가 없는 채로 settle→ready→betting(→acting)→settle이 ' +
      '타임아웃만으로 최소 한 바퀴 굴러가도(=아무도 못 끝내는 무한 순환이 실제로 재현됨), ' +
      '승격된 새 host의 endGame으로 그 순환을 확실히 탈출할 수 있다',
    () => {
      const { room, sent, tick } = setup();
      room.join('철수'); // host
      room.join('영희');
      room.join('민수');
      room.handleMessage('철수', { type: 'action', name: 'start' });
      advanceToSettle(room, ['철수', '영희', '민수'], [100, 50, 50]);
      expect((lastState(sent['영희']).view as any).phase).toBe('settle');

      room.leave('철수'); // host 이탈 — 이 라운드가 도는 동안 원래 host는 더 이상 없다.
      expect(lastState(sent['영희']).room.host).toBe('영희');
      expect(lastState(sent['영희']).phase).toBe('playing'); // 2명 남아 게임은 계속된다

      // 아무도 endGame을 부르지 않은 채 타임아웃만으로 순환이 실제로 굴러가는지 확인한다 —
      // 최소 한 번은 settle을 벗어났다가(ready→betting[→acting]) 다시 settle로 돌아와야 한다.
      // 이것이 Task 4 리뷰가 지적한 "host 없이는 영원히 도는" 바로 그 경로다.
      let leftSettleOnce = false;
      let backInSettle = false;
      for (let i = 0; i < 8 && !backInSettle; i++) {
        tick(TURN_TIMEOUT_MS + 1);
        const phase = (lastState(sent['영희']).view as any).phase as string;
        if (phase !== 'settle') leftSettleOnce = true;
        if (leftSettleOnce && phase === 'settle') backInSettle = true;
      }
      expect(leftSettleOnce).toBe(true);
      expect(backInSettle).toBe(true);
      expect(lastState(sent['영희']).phase).toBe('playing'); // Room 차원에서는 아직 끝나지 않았다

      // 승격된 새 host(영희)만이 이 순환을 끝낼 수 있다 — 그리고 이제는 받아들여진다.
      room.handleMessage('영희', { type: 'action', name: 'endGame' });
      expect(lastState(sent['영희']).phase).toBe('result');
    },
  );
});

describe('Room — 빈 방 복구(완전히 비었던 방이 좌초되지 않아야 한다)', () => {
  it('host 공석이 null로 표현되어도(문자열 센티널 아님) 재입장자가 정상적으로 host를 물려받는다', () => {
    const { room, sent } = setup();
    room.join('철수');
    room.leave('철수'); // 방이 완전히 빈다 — 내부적으로 host는 null(진짜 공석)이 된다

    // 두 번째 입장자가 host가 되는 게 아니라, "정말로 비어 있을 때 들어온 첫 사람"이 host가
    // 되어야 한다 — 그리고 그 뒤로는 공석이 아니므로 세 번째 입장자가 또 가로채면 안 된다.
    expect(room.join('영희')).toEqual({ ok: true });
    expect(lastState(sent['영희']).room.host).toBe('영희');

    expect(room.join('민수')).toEqual({ ok: true });
    expect(lastState(sent['민수']).room.host).toBe('영희'); // 이미 채워진 자리를 민수가 가로채지 않는다
  });

  it('lobby에서 마지막 인원이 나가도, 새로 들어온 사람이 host가 되어 정상적으로 시작할 수 있다', () => {
    const { room, sent } = setup();
    room.join('철수'); // host
    room.leave('철수'); // 방이 완전히 빈다

    expect(room.info().players).toBe(`0/${MAX_PLAYERS}`);

    expect(room.join('영희')).toEqual({ ok: true }); // join()이 'playing'으로 영구 고정되지 않았다
    const lobbyState = lastState(sent['영희']);
    expect(lobbyState.phase).toBe('lobby');
    expect(lobbyState.room.host).toBe('영희'); // 죽은 host('철수') 이름에 고정되지 않았다

    // 아직 minPlayers(2) 미만이므로 start는 정상적으로 "인원 부족" 안내만 온다 — 즉 영희가
    // host로 제대로 인식되고 있다(host가 아니라는 거부가 아니라 인원 부족 거부라는 점이 중요).
    room.handleMessage('영희', { type: 'action', name: 'start' });
    expect(lastState(sent['영희']).phase).toBe('lobby');
    expect(events(sent['영희']).length).toBeGreaterThan(0);
    expect(events(sent['영희'])[0].text).not.toContain('방장');

    expect(room.join('민수')).toEqual({ ok: true });
    room.handleMessage('영희', { type: 'action', name: 'start' });
    expect(lastState(sent['영희']).phase).toBe('playing'); // 정상적으로 시작된다
  });

  it(
    'playing 중 마지막 인원이 나가도 방이 되살아난다 — 새로 입장한 두 사람이 ' +
      '버려진 라운드를 이어받지 않고 완전히 새 게임을 깨끗하게 시작할 수 있다',
    () => {
      const { room, sent } = setup();
      room.join('철수'); // host
      room.join('영희');
      room.handleMessage('철수', { type: 'action', name: 'start' });
      expect(lastState(sent['철수']).phase).toBe('playing');

      room.leave('철수'); // 2명 중 1명만 남아 엔진이 스스로 종료 → phase 'result'
      expect(lastState(sent['영희']).phase).toBe('result');

      room.leave('영희'); // 방이 완전히 빈다(phase가 'playing'/'result'에 멈춰있던 채로)

      expect(room.info().players).toBe(`0/${MAX_PLAYERS}`); // 더 이상 "0/6"에 'playing'으로 갇히지 않는다

      expect(room.join('민수')).toEqual({ ok: true }); // join()이 더 이상 {code:'playing'}을 반환하지 않는다
      expect(room.join('지영')).toEqual({ ok: true });
      const lobbyState = lastState(sent['민수']);
      expect(lobbyState.phase).toBe('lobby');
      expect(lobbyState.room.host).toBe('민수'); // 죽은 host('철수'/'영희') 이름에 고정되지 않았다
      expect(lobbyState.room.players).toEqual(['민수', '지영']);

      room.handleMessage('민수', { type: 'action', name: 'start' });
      const started = lastState(sent['민수']);
      expect(started.phase).toBe('playing');

      // 버려진 라운드가 재개된 게 아니라 진짜 새 엔진인지 확인한다: 새 플레이어만 등장해야 하고
      // (예전 철수/영희의 흔적 없음), 블랙잭 새 라운드는 항상 betting에서 시작 칩 그대로 연다.
      const view = started.view as any;
      expect(view.phase).toBe('betting');
      expect(view.you.chips).toBe(1000); // START_CHIPS — 이전 라운드의 잔여 칩이 아니다
      expect(view.others.map((o: any) => o.nickname)).toEqual(['지영']); // 철수/영희 흔적 없음
      expect(started.room.players).toEqual(['민수', '지영']);
    },
  );
});

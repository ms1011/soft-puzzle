# 고민 중 커서 공유(focus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 차례인 사람의 확정 전 커서를 다른 참가자에게 실시간으로 보여준다(원카드·다빈치·야추, 마피아 밤은 마피아끼리).

**Architecture:** 새 `focus` 메시지를 Room이 엔진의 선택 메서드 `focusRoute`로 검증·정리한 뒤 수신자에게 전달만 한다. 엔진 상태와 deadline은 바뀌지 않는다. 클라이언트는 `state`를 받을 때마다 커서 표시를 지우고, 고르는 중인 사람은 커서를 다시 보낸다.

**Tech Stack:** TypeScript, Ink(React) TUI, vitest, ink-testing-library. npm workspaces(`packages/core`, `packages/server`, `packages/client`).

**Spec:** `docs/superpowers/specs/2026-09-22-focus-sharing-design.md`

## Global Constraints

- 테스트: 패키지 폴더에서 `npx vitest run <파일>`(루트에서 경로를 주면 파일을 못 찾는다). 전체는 루트에서 `npx vitest run`.
- 타입체크: 루트에서 `npm run typecheck`. 빌드: `npm run build`.
- ascii 테마(`theme.unicode === false`) 화면에는 ASCII·한글 외 문자가 한 글자도 나오면 안 된다(`findNonAsciiNonHangul`).
- 수신자 규칙·정리된 target 규칙은 스펙 "게임별 규칙" 표 그대로.
- 전송 빈도: 클라이언트 100ms 스로틀(trailing), 서버 1인당 1초 20개 초과분 폐기.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. `package.json`·`package-lock.json`·`*.tgz`는 커밋하지 않는다(사용자의 무관한 변경).

## File Structure

- `packages/core/src/protocol.ts` — ClientMsg/ServerMsg에 `focus` 추가.
- `packages/core/src/engine.ts` — `FocusRoute` 타입, `focusRoute?` 메서드, `focusField` 헬퍼.
- `packages/core/src/index.ts` — `FocusRoute`, `focusField` export.
- `packages/core/src/games/{onecard,davinci,yacht,mafia}.ts` — 각 `focusRoute`.
- `packages/core/test/focus.test.ts` — 네 엔진의 `focusRoute` 테스트(새 파일).
- `packages/server/src/room.ts` — `focus` 분기, 전송 빈도 제한.
- `packages/server/test/room.test.ts` — Room focus 테스트.
- `packages/client/src/ui/focus.ts` — `reduceFocus`, `useFocusBroadcast`(새 파일).
- `packages/client/src/ui/game/types.ts` — `focus?`, `sendFocus?` prop.
- `packages/client/src/ui/App.tsx` — focusMap 상태와 전달.
- `packages/client/src/ui/game/CardRows.tsx` — 조각별 `color`.
- `packages/client/src/ui/game/{OneCardView,DavinciView,YachtView,MafiaView}.tsx` — 전송과 표시.
- `packages/client/test/focus.test.tsx`, 각 뷰 테스트.

---

### Task 1: 프로토콜·엔진 인터페이스와 원카드 focusRoute

**Files:**
- Modify: `packages/core/src/protocol.ts`, `packages/core/src/engine.ts`, `packages/core/src/index.ts`, `packages/core/src/games/onecard.ts`
- Create: `packages/core/test/focus.test.ts`

**Interfaces:**
- Produces: `type FocusRoute = { to: string[] | 'all'; target: unknown } | null`; `GameEngine.focusRoute?(sender: string, target: unknown): FocusRoute`; `focusField(target: unknown, key: string): unknown`; ClientMsg `{ type: 'focus'; target: unknown }`; ServerMsg `{ type: 'focus'; from: string; target: unknown }`.

- [ ] **Step 1: 실패하는 테스트 작성** — `packages/core/test/focus.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { OneCardEngine } from '../src/games/onecard.js';
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
```

- [ ] **Step 2: 실패 확인** — `cd packages/core && npx vitest run test/focus.test.ts` → FAIL(`focusRoute is not a function` 또는 타입 오류).

- [ ] **Step 3: 구현**

`protocol.ts` — ClientMsg 끝에 추가:
```ts
  | { type: 'chat'; text: string }
  // 확정 전 커서. target의 모양은 게임마다 다르고 null은 "고민 중 아님"이다 — 서버가 엔진에 물어 검증·정리한다.
  | { type: 'focus'; target: unknown };
```
ServerMsg 끝에 추가:
```ts
  | { type: 'chat'; from: string; text: string; channel: ChatChannel }
  | { type: 'focus'; from: string; target: unknown };
```

`engine.ts` — ChatRoute 아래에 추가:
```ts
/**
 * 확정 전 커서(focus)를 누구에게, 어떤 모양으로 보낼지에 대한 엔진의 결정. null이면 전달하지 않는다.
 * target은 받은 값을 그대로 돌려주지 말고 검증한 필드만으로 새로 만든다 — focus가 막힌 사람의 몰래
 * 쓰는 채팅 통로가 되지 않게 하기 위해서다. 'all'은 방 전원(Room이 채운다)이다.
 */
export type FocusRoute = { to: string[] | 'all'; target: unknown } | null;

/** 네트워크에서 온 target 객체의 필드 하나를 안전하게 꺼낸다(객체가 아니면 undefined). */
export function focusField(target: unknown, key: string): unknown {
  return typeof target === 'object' && target !== null ? (target as Record<string, unknown>)[key] : undefined;
}
```
GameEngine 인터페이스 끝(`chatRoute?` 아래)에 추가:
```ts
  // 선택: 차례인 사람의 확정 전 커서를 누구에게 보여줄지 엔진이 정한다. 없으면 그 게임은 커서를 공유하지 않는다.
  focusRoute?(sender: string, target: unknown): FocusRoute;
```

`index.ts` — engine export 줄을 바꾼다:
```ts
export type { EngineEvent, EngineAction, GameEngine, ChatRoute, FocusRoute } from './engine.js';
export { focusField } from './engine.js';
```

`onecard.ts` — import에 `FocusRoute`와 `focusField`를 추가하고(`import type { GameEngine, EngineAction, EngineEvent, FocusRoute } from '../engine.js'; import { focusField } from '../engine.js';`), `getViewFor` 아래에 메서드 추가:
```ts
  /** 차례인 사람이 손패의 몇 번째 카드를 보고 있는지만 전원에게 알린다 — 카드 내용은 보내지 않는다. */
  focusRoute(sender: string, target: unknown): FocusRoute {
    if (this.ended || this.order[this.turnIdx] !== sender) return null;
    if (target === null) return { to: 'all', target: null };
    const index = focusField(target, 'index');
    const handSize = this.hands.get(sender)?.length ?? 0;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= handSize) return null;
    return { to: 'all', target: { index } };
  }
```

- [ ] **Step 4: 통과 확인** — `cd packages/core && npx vitest run test/focus.test.ts` → PASS. 루트에서 `npm run typecheck` → 오류 없음.

- [ ] **Step 5: 커밋**
```bash
git add packages/core/src/protocol.ts packages/core/src/engine.ts packages/core/src/index.ts packages/core/src/games/onecard.ts packages/core/test/focus.test.ts
git commit -m "feat(core): add focus message and one card focusRoute"
```

### Task 2: 다빈치·야추·마피아 focusRoute

**Files:**
- Modify: `packages/core/src/games/davinci.ts`, `packages/core/src/games/yacht.ts`, `packages/core/src/games/mafia.ts`
- Test: `packages/core/test/focus.test.ts`

**Interfaces:**
- Consumes: `FocusRoute`, `focusField`(Task 1).
- Produces: 다빈치 target `{ player: string; index: number }`, 야추 `{ category: YachtCategory }`, 마피아 `{ target: string }`.

- [ ] **Step 1: 실패하는 테스트 추가** — `focus.test.ts`에 import와 describe 추가

```ts
import { DavinciEngine } from '../src/games/davinci.js';
import { YachtEngine } from '../src/games/yacht.js';
import { MafiaEngine } from '../src/games/mafia.js';

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
```

- [ ] **Step 2: 실패 확인** — `cd packages/core && npx vitest run test/focus.test.ts` → 새 describe들 FAIL.

- [ ] **Step 3: 구현** — 세 엔진 모두 import에 `FocusRoute` 타입과 `focusField`를 추가한다.

`davinci.ts` (`getViewFor` 아래):
```ts
  /** 차례인 사람이 겨누는 상대 타일을 전원에게 알린다 — 추리하려는 숫자는 절대 담지 않는다. */
  focusRoute(sender: string, target: unknown): FocusRoute {
    if (this.finished || this.players[this.turn] !== sender) return null;
    if (target === null) return { to: 'all', target: null };
    const player = focusField(target, 'player');
    const index = focusField(target, 'index');
    if (typeof player !== 'string' || player === sender || typeof index !== 'number' || !Number.isInteger(index)) return null;
    const tile = this.tiles.get(player)?.[index];
    if (tile === undefined || tile.revealed || this.isEliminated(player)) return null;
    return { to: 'all', target: { player, index } };
  }
```

`yacht.ts` (`getViewFor` 아래):
```ts
  /** 차례인 사람이 점수 칸 선택 모드에서 보고 있는 빈 칸을 전원에게 알린다. */
  focusRoute(sender: string, target: unknown): FocusRoute {
    if (this.finished || this.order[this.turnIdx] !== sender) return null;
    if (target === null) return { to: 'all', target: null };
    const category = focusField(target, 'category');
    if (typeof category !== 'string' || !ALL_CATEGORIES.includes(category as YachtCategory)) return null;
    if (category in (this.sheets.get(sender) ?? {})) return null;
    return { to: 'all', target: { category } };
  }
```

`mafia.ts` (`chatStatus` 아래):
```ts
  /**
   * 밤에 아직 행동하지 않은 살아 있는 마피아의 조준만, 살아 있는 마피아끼리 공유한다. 낮 투표 커서는
   * 숨긴다(투표는 비밀이다) — 시민·특수직업·탈락자의 커서도 전달하지 않는다.
   */
  focusRoute(sender: string, target: unknown): FocusRoute {
    if (this.finished || this.phase !== 'night' || !this.alive.has(sender)) return null;
    if (this.roles.get(sender) !== 'mafia' || this.actions.has(sender)) return null;
    const to = this.players.filter((p) => this.alive.has(p) && this.roles.get(p) === 'mafia');
    if (target === null) return { to, target: null };
    const aim = focusField(target, 'target');
    if (typeof aim !== 'string' || aim === sender || !this.alive.has(aim)) return null;
    return { to, target: { target: aim } };
  }
```

- [ ] **Step 4: 통과 확인** — `cd packages/core && npx vitest run test/focus.test.ts` → PASS. 마피아 테스트에서 seed 3이 시민 2명 이상을 만들지 않으면(6인·마피아2·의사1이면 시민 3명이라 항상 충분) 그대로 통과한다. `npm run typecheck` → 오류 없음.

- [ ] **Step 5: 커밋**
```bash
git add packages/core/src/games/davinci.ts packages/core/src/games/yacht.ts packages/core/src/games/mafia.ts packages/core/test/focus.test.ts
git commit -m "feat(core): add focusRoute for davinci, yacht and mafia"
```

### Task 3: Room의 focus 전달

**Files:**
- Modify: `packages/server/src/room.ts`
- Test: `packages/server/test/room.test.ts`

**Interfaces:**
- Consumes: ClientMsg/ServerMsg `focus`, `GameEngine.focusRoute`(Task 1–2).
- Produces: 서버가 `{ type: 'focus', from, target }`를 수신자에게 보낸다.

- [ ] **Step 1: 실패하는 테스트 추가** — `room.test.ts` 맨 아래

```ts
type FocusMsg = Extract<ServerMsg, { type: 'focus' }>;
function focuses(msgs: ServerMsg[] | undefined): FocusMsg[] {
  return (msgs ?? []).filter((m): m is FocusMsg => m.type === 'focus');
}

describe('Room — focus', () => {
  function onecardRoom() {
    const ctx = setup({ game: 'onecard' });
    for (const p of ['철수', '영희', '민수']) ctx.room.join(p);
    ctx.room.handleMessage('철수', { type: 'action', name: 'start' });
    return ctx; // 첫 차례는 철수
  }

  it('차례인 사람의 focus는 자기 자신을 뺀 방 전원에게, 정리된 target으로 간다', () => {
    const { room, sent } = onecardRoom();
    room.handleMessage('철수', { type: 'focus', target: { index: 2, junk: true } });
    expect(focuses(sent['영희'])).toEqual([{ type: 'focus', from: '철수', target: { index: 2 } }]);
    expect(focuses(sent['민수'])).toHaveLength(1);
    expect(focuses(sent['철수'])).toHaveLength(0);
  });

  it('차례가 아닌 사람의 focus와 형식이 틀린 focus는 전달되지 않는다', () => {
    const { room, sent } = onecardRoom();
    room.handleMessage('영희', { type: 'focus', target: { index: 0 } });
    room.handleMessage('철수', { type: 'focus', target: { index: 99 } });
    expect(focuses(sent['민수'])).toHaveLength(0);
  });

  it('focus는 state를 새로 보내지 않는다', () => {
    const { room, sent } = onecardRoom();
    const before = (sent['영희'] ?? []).filter((m) => m.type === 'state').length;
    room.handleMessage('철수', { type: 'focus', target: { index: 0 } });
    expect((sent['영희'] ?? []).filter((m) => m.type === 'state').length).toBe(before);
  });

  it('로비의 focus는 무시된다', () => {
    const { room, sent } = setup({ game: 'onecard' });
    room.join('철수');
    room.join('영희');
    room.handleMessage('철수', { type: 'focus', target: { index: 0 } });
    expect(focuses(sent['영희'])).toHaveLength(0);
  });

  it('1초에 20개를 넘는 focus는 버리고, 1초가 지나면 다시 받는다', () => {
    const { room, sent, tick } = onecardRoom();
    for (let i = 0; i < 25; i++) room.handleMessage('철수', { type: 'focus', target: { index: i % 7 } });
    expect(focuses(sent['영희'])).toHaveLength(20);
    tick(1000);
    room.handleMessage('철수', { type: 'focus', target: { index: 0 } });
    expect(focuses(sent['영희'])).toHaveLength(21);
  });

  it('focusRoute가 없는 게임(라이어)은 아무것도 전달하지 않는다', () => {
    const { room, sent } = setup({ game: 'liar' });
    for (const p of ['철수', '영희', '민수']) room.join(p);
    room.handleMessage('철수', { type: 'action', name: 'start' });
    room.handleMessage('철수', { type: 'focus', target: { target: '영희' } });
    expect(focuses(sent['영희'])).toHaveLength(0);
  });

  it('마피아 밤 조준은 동료 마피아만 받고, 시민은 받지 못한다', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const { room, sent } = setup({ game: 'mafia', host: 'p1', mafiaSettings: { mafiaCount: 2, specialRoles: [] } });
    for (const p of players) room.join(p);
    room.handleMessage('p1', { type: 'action', name: 'start' });
    const roleOf = (p: string) => (lastState(sent[p]).view as { yourRole: string }).yourRole;
    const mafia = players.filter((p) => roleOf(p) === 'mafia');
    const citizens = players.filter((p) => roleOf(p) !== 'mafia');
    room.handleMessage(mafia[0]!, { type: 'focus', target: { target: citizens[0]! } });
    expect(focuses(sent[mafia[1]!])).toEqual([{ type: 'focus', from: mafia[0], target: { target: citizens[0] } }]);
    for (const c of citizens) expect(focuses(sent[c])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd packages/server && npx vitest run test/room.test.ts` → 새 테스트 FAIL.

- [ ] **Step 3: 구현** — `room.ts`

파일 위 상수 영역(`MAX_NICKNAME_LENGTH` 아래):
```ts
/** 한 사람이 1초에 보낼 수 있는 focus 수. 넘치면 버린다 — 키를 꾹 누른 클라이언트나 악의적 폭주를 막는다. */
const FOCUS_LIMIT_PER_SECOND = 20;
```
필드(`sendCb` 아래):
```ts
  private focusTimes = new Map<string, number[]>();
```
`handleMessage`의 chat 분기 뒤:
```ts
    } else if (type === 'focus') {
      this.handleFocus(nick, (msg as { target?: unknown }).target ?? null);
    }
```
`leave()`의 맨 앞 guard 다음 줄에 `this.focusTimes.delete(nick);` 추가.

`handleChat` 아래에 추가:
```ts
  /**
   * 차례인 사람의 확정 전 커서를 엔진이 정한 수신자에게 전달한다. 엔진 상태·deadline은 건드리지 않고
   * state도 새로 보내지 않는다. 받은 target이 아니라 엔진이 정리한 target만 보낸다.
   */
  private handleFocus(nickname: string, target: unknown): void {
    if (this.phase !== 'playing' || !this.engine?.focusRoute) return;
    if (!this.engine.pendingPlayers().includes(nickname)) return;
    if (!this.takeFocusSlot(nickname)) return;
    const route = this.engine.focusRoute(nickname, target);
    if (route === null) return;
    const recipients = route.to === 'all' ? this.players : this.players.filter((p) => route.to.includes(p));
    for (const p of recipients) {
      if (p !== nickname) this.send(p, { type: 'focus', from: nickname, target: route.target });
    }
  }

  /** 최근 1초 안의 focus 수가 한도 미만이면 한 칸을 쓰고 true. */
  private takeFocusSlot(nickname: string): boolean {
    const now = this.now();
    const recent = (this.focusTimes.get(nickname) ?? []).filter((t) => now - t < 1000);
    const allowed = recent.length < FOCUS_LIMIT_PER_SECOND;
    if (allowed) recent.push(now);
    this.focusTimes.set(nickname, recent);
    return allowed;
  }
```

- [ ] **Step 4: 통과 확인** — `cd packages/server && npx vitest run test/room.test.ts` → PASS. `npm run typecheck` → 오류 없음.

- [ ] **Step 5: 커밋**
```bash
git add packages/server/src/room.ts packages/server/test/room.test.ts
git commit -m "feat(server): relay focus messages through engine focusRoute"
```

### Task 4: 클라이언트 focus 기반(리듀서·전송 훅·App 연결)

**Files:**
- Create: `packages/client/src/ui/focus.ts`, `packages/client/test/focus.test.tsx`
- Modify: `packages/client/src/ui/game/types.ts`, `packages/client/src/ui/App.tsx`

**Interfaces:**
- Consumes: ServerMsg `focus`(Task 1).
- Produces: `type FocusMap = Record<string, unknown>`; `reduceFocus(map: FocusMap, msg: ServerMsg): FocusMap`; `useFocusBroadcast(sendFocus: ((target: unknown) => void) | undefined, target: unknown, view: unknown): void`; `FOCUS_INTERVAL_MS = 100`; `GameViewProps.focus?: FocusMap`, `GameViewProps.sendFocus?: (target: unknown) => void`.

- [ ] **Step 1: 실패하는 테스트 작성** — `packages/client/test/focus.test.tsx`

```tsx
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { reduceFocus, useFocusBroadcast, FOCUS_INTERVAL_MS } from '../src/ui/focus.js';

describe('reduceFocus', () => {
  it('focus는 보낸 사람별로 저장하고, target null이면 지운다', () => {
    const a = reduceFocus({}, { type: 'focus', from: '영희', target: { index: 1 } });
    expect(a).toEqual({ 영희: { index: 1 } });
    expect(reduceFocus(a, { type: 'focus', from: '영희', target: null })).toEqual({});
  });

  it('state를 받으면 전부 지운다', () => {
    const map = { 영희: { index: 1 } };
    expect(reduceFocus(map, { type: 'state', phase: 'lobby', room: { name: 'r', game: 'onecard', host: 'a', players: [] } })).toEqual({});
  });

  it('다른 메시지는 그대로 둔다', () => {
    const map = { 영희: { index: 1 } };
    expect(reduceFocus(map, { type: 'event', text: 'x' })).toBe(map);
  });
});

function Probe({ send, target, view }: { send: (t: unknown) => void; target: unknown; view: unknown }) {
  useFocusBroadcast(send, target, view);
  return <Text>probe</Text>;
}

describe('useFocusBroadcast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('처음 값은 바로 보내고, 100ms 안의 연속 변경은 마지막 값 하나로 합친다', () => {
    const send = vi.fn();
    const view = {};
    const { rerender, unmount } = render(<Probe send={send} target={{ index: 0 }} view={view} />);
    expect(send.mock.calls).toEqual([[{ index: 0 }]]);
    rerender(<Probe send={send} target={{ index: 1 }} view={view} />);
    rerender(<Probe send={send} target={{ index: 2 }} view={view} />);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FOCUS_INTERVAL_MS);
    expect(send.mock.calls).toEqual([[{ index: 0 }], [{ index: 2 }]]);
    unmount();
  });

  it('새 view가 오면 같은 값이라도 다시 보낸다', () => {
    const send = vi.fn();
    const { rerender, unmount } = render(<Probe send={send} target={{ index: 0 }} view={{ n: 1 }} />);
    vi.advanceTimersByTime(FOCUS_INTERVAL_MS);
    rerender(<Probe send={send} target={{ index: 0 }} view={{ n: 2 }} />);
    vi.advanceTimersByTime(FOCUS_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('null로 바뀌면 null을 보내고, null인 채로는 새 view가 와도 보내지 않는다', () => {
    const send = vi.fn();
    const { rerender, unmount } = render(<Probe send={send} target={{ index: 0 }} view={{ n: 1 }} />);
    vi.advanceTimersByTime(FOCUS_INTERVAL_MS);
    rerender(<Probe send={send} target={null} view={{ n: 1 }} />);
    vi.advanceTimersByTime(FOCUS_INTERVAL_MS);
    rerender(<Probe send={send} target={null} view={{ n: 2 }} />);
    vi.advanceTimersByTime(FOCUS_INTERVAL_MS);
    expect(send.mock.calls).toEqual([[{ index: 0 }], [null]]);
    unmount();
  });

  it('보낸 적 있으면 화면이 닫힐 때 null을 보낸다', () => {
    const send = vi.fn();
    const { unmount } = render(<Probe send={send} target={{ index: 0 }} view={{}} />);
    unmount();
    expect(send.mock.calls.at(-1)).toEqual([null]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd packages/client && npx vitest run test/focus.test.tsx` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `packages/client/src/ui/focus.ts`

```ts
import { useEffect, useRef } from 'react';
import type { ServerMsg } from '@soft-puzzle/core';

/** 다른 참가자의 확정 전 커서. 닉네임 → 게임별 target. */
export type FocusMap = Record<string, unknown>;

/** 커서를 보내는 최소 간격. 키를 꾹 눌러도 초당 10개를 넘지 않는다(서버 한도 20개). */
export const FOCUS_INTERVAL_MS = 100;

/**
 * 서버 메시지로 FocusMap을 갱신한다. state가 오면 전부 지운다 — 행동이 확정되거나 차례가 넘어가면
 * 항상 새 state가 오므로 오래된 커서가 남지 않는다(아직 고르는 사람은 다시 보낸다).
 */
export function reduceFocus(map: FocusMap, msg: ServerMsg): FocusMap {
  if (msg.type === 'state') return Object.keys(map).length === 0 ? map : {};
  if (msg.type !== 'focus') return map;
  if (msg.target === null) {
    const { [msg.from]: _removed, ...rest } = map;
    return rest;
  }
  return { ...map, [msg.from]: msg.target };
}

/**
 * 내가 지금 고르고 있는 것(target)을 서버로 보낸다. target이 바뀌면 FOCUS_INTERVAL_MS에 한 번,
 * 마지막 값은 반드시 보낸다. 새 view(state)가 오면 null이 아닌 target을 다시 보낸다 — 새 state를
 * 받은 다른 참가자들이 커서 표시를 지웠기 때문이다. 화면이 닫히면 보낸 적 있을 때 null을 보낸다.
 */
export function useFocusBroadcast(
  sendFocus: ((target: unknown) => void) | undefined,
  target: unknown,
  view: unknown,
): void {
  const key = JSON.stringify(target ?? null);
  const sendRef = useRef(sendFocus);
  sendRef.current = sendFocus;
  const lastSent = useRef('null');
  const lastTime = useRef(-Infinity);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = (): void => {
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    lastSent.current = next;
    lastTime.current = Date.now();
    sendRef.current?.(JSON.parse(next));
  };

  const schedule = (next: string, force: boolean): void => {
    if (!force && next === lastSent.current && pending.current === null) return;
    pending.current = next;
    if (timer.current !== null) return;
    const wait = FOCUS_INTERVAL_MS - (Date.now() - lastTime.current);
    if (wait <= 0) flush();
    else timer.current = setTimeout(flush, wait);
  };

  useEffect(() => schedule(key, false), [key]);
  useEffect(() => {
    if (key !== 'null') schedule(key, true);
    // key는 위 effect가 맡는다 — 여기서는 view가 바뀔 때만 다시 보낸다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (lastSent.current !== 'null') sendRef.current?.(null);
    },
    [],
  );
}
```

`types.ts` — `GameViewProps`에 추가(`theme` 아래):
```ts
  /** 다른 참가자의 확정 전 커서(닉네임 → 게임별 target). 없으면 커서 공유를 표시하지 않는다. */
  focus?: Record<string, unknown>;
  /** 내 확정 전 커서를 서버로 보낸다. 뷰는 useFocusBroadcast로만 쓴다. */
  sendFocus?: (target: unknown) => void;
```

`App.tsx`:
1. import 추가: `import { reduceFocus } from './focus.js'; import type { FocusMap } from './focus.js';`
2. `GameScreen`의 props 타입과 구조분해에 `focus`, `sendFocus`를 넣고 `<View ... focus={focus} sendFocus={sendFocus} />`로 넘긴다(`GameViewProps`에 이미 포함되므로 타입은 그대로 `GameViewProps & { game; deadline? }`).
3. 상태 추가(`chatOpen` 아래): `const [focusMap, setFocusMap] = useState<FocusMap>({});`
4. `handleServerMsg` 맨 앞에 `setFocusMap((prev) => reduceFocus(prev, msg));`를 넣고, 분기에 `msg.type === 'focus'`는 따로 처리하지 않는다(리듀서가 처리).
5. `conn.onClose`와 `returnToMenu`에서 `setFocusMap({});`
6. `sendChat` 아래:
```ts
  const sendFocus = useCallback((target: unknown): void => {
    connectionRef.current?.send({ type: 'focus', target });
  }, []);
```
7. `<GameScreen ... focus={focusMap} sendFocus={sendFocus} />`

- [ ] **Step 4: 통과 확인** — `cd packages/client && npx vitest run test/focus.test.tsx` → PASS. `npm run typecheck` → 오류 없음. `npx vitest run`(client 전체) → PASS.

- [ ] **Step 5: 커밋**
```bash
git add packages/client/src/ui/focus.ts packages/client/test/focus.test.tsx packages/client/src/ui/game/types.ts packages/client/src/ui/App.tsx
git commit -m "feat(client): add focus reducer, broadcast hook and app wiring"
```

### Task 5: 원카드·다빈치 커서 전송과 표시

**Files:**
- Modify: `packages/client/src/ui/game/CardRows.tsx`, `packages/client/src/ui/game/OneCardView.tsx`, `packages/client/src/ui/game/DavinciView.tsx`
- Test: `packages/client/test/onecard-view.test.tsx`, `packages/client/test/davinci-view.test.tsx`

**Interfaces:**
- Consumes: `useFocusBroadcast`, `GameViewProps.focus/sendFocus`(Task 4). 원카드 target `{ index }`, 다빈치 `{ player, index }`.

- [ ] **Step 1: 실패하는 테스트 추가**

`onecard-view.test.tsx` — 기존 "상대가 8장을 넘게 쥐면" 테스트를 아래로 바꾸고, 새 테스트를 추가한다:
```tsx
  it('상대가 7장을 넘게 쥐면 7장만 그리고 닉네임 줄에 +N으로 나머지를 알린다', () => {
    const view = playingView({ others: [{ nickname: '영희', handCount: 12, isTurn: false }] });
    const { lastFrame, unmount } = render(<OneCardView {...baseProps({ view })} />);
    const nameLine = (lastFrame() ?? '').split('\n').find((line) => line.includes('영희'))!;
    expect(nameLine).toContain('12장');
    expect(nameLine).toContain('+5');
    unmount();
  });

  it('차례인 상대의 focus 카드는 한 줄 들어 올려 그린다', () => {
    const view = playingView({ yourActions: [], you: { hand: ['KH'], handCount: 1, isTurn: false }, others: [{ nickname: '영희', handCount: 3, isTurn: true }] });
    const still = render(<OneCardView {...baseProps({ view })} />);
    const lifted = render(<OneCardView {...baseProps({ view, focus: { 영희: { index: 0 } } })} />);
    // 들어 올린 카드는 비워 둔 맨 윗줄(닉네임 바로 아래)에 윗테두리가 생긴다.
    const rowBelowName = (frame: string) => frame.split('\n')[frame.split('\n').findIndex((l) => l.includes('영희')) + 1]!;
    expect(rowBelowName(still.lastFrame() ?? '').trim()).toBe('');
    expect(rowBelowName(lifted.lastFrame() ?? '')).toContain('┌');
    still.unmount();
    lifted.unmount();
  });

  it('내 차례에 커서 위치를 sendFocus로 보낸다', async () => {
    const sendFocus = vi.fn();
    const { stdin, unmount } = render(<OneCardView {...baseProps({ sendFocus })} />);
    await tick();
    expect(sendFocus).toHaveBeenCalledWith({ index: 0 });
    stdin.write(RIGHT_ARROW);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sendFocus).toHaveBeenLastCalledWith({ index: 1 });
    unmount();
  });
```
`davinci-view.test.tsx`에 추가:
```tsx
  it('다른 사람이 겨누는 타일을 문구로 알리고, 내 타일이면 경고한다', () => {
    const view = davinciView({ yourActions: [], isTurn: false, turnPlayer: '영희' });
    const { lastFrame, unmount } = render(<DavinciView {...baseProps({ view, focus: { 영희: { player: '철수', index: 2 } } })} />);
    expect(lastFrame()).toContain('영희님이 내 3번 타일을 노리고 있습니다!');
    unmount();
  });

  it('내 차례에 겨누는 타일을 sendFocus로 보낸다', async () => {
    const sendFocus = vi.fn();
    const { unmount } = render(<DavinciView {...baseProps({ sendFocus })} />);
    await tick();
    expect(sendFocus).toHaveBeenCalledWith({ player: '영희', index: 0 });
    unmount();
  });
```
(다빈치 기본 fixture에서 철수의 3번 타일(index 2)은 숨김 상태다. 문구는 1부터 센다.)

- [ ] **Step 2: 실패 확인** — `cd packages/client && npx vitest run test/onecard-view.test.tsx test/davinci-view.test.tsx` → 새 테스트 FAIL.

- [ ] **Step 3: 구현**

`CardRows.tsx` — 조각 타입에 `color?: string`을 더하고 색 결정식을 바꾼다:
```tsx
  rows: (CardSegment & { dim?: boolean; color?: string })[][];
...
            <Text key={i} color={seg.red ? 'red' : (seg.color ?? color)} dimColor={seg.dim === true}>
```

`OneCardView.tsx`:
- import: `import { useFocusBroadcast } from '../focus.js';`
- 상수: `OPPONENT_VISIBLE_CARDS = 7`로 바꾸고 주석을 "들어 올린 중간 카드는 온전한 폭이라 2×5+7+7=24칸 — 칸 폭 26 안에 들어간다. 넘치는 장수는 닉네임 줄에 +N으로 알린다."로 고친다. 칸 폭 주석도 "뒷면 7장(들어 올리면 24칸)과 옆 칸 여백"으로 고친다.
- `OpponentHand`에 `focusIndex: number | null` prop 추가:
```tsx
function OpponentHand({ player, focusIndex, theme }: { player: OtherPlayer; focusIndex: number | null; theme: GameViewProps['theme'] }): React.JSX.Element {
  const visible = Math.min(player.handCount, OPPONENT_VISIBLE_CARDS);
  const hidden = player.handCount - visible;
  // 그려지지 않은 카드(+N 쪽)를 고민 중이면 카드를 들지 않고 +N을 강조한다.
  const liftIndex = focusIndex !== null && focusIndex < visible ? focusIndex : -1;
  const focusOnHidden = focusIndex !== null && focusIndex >= visible;
  const backs = Array<Card>(visible).fill('back');
  const rows = visible > 0 ? renderLiftedHand(backs, liftIndex, [], theme) : [];
  return (
    <Box flexDirection="column" width={OPPONENT_WIDTH} marginBottom={1}>
      <Text bold={player.isTurn} wrap="truncate-end">
        {player.isTurn ? `${turnGlyph(theme)} ` : '  '}
        {truncateDisplay(player.nickname, OPPONENT_NICK_CAP)} {player.handCount}장
        {hidden > 0 && <Text color={focusOnHidden ? 'yellow' : undefined}> +{hidden}</Text>}
      </Text>
      {visible === 0 ? (
        <Text dimColor>  (손패 없음)</Text>
      ) : (
        <CardRows rows={rows.map((row) => row.map((seg, i) => (i === liftIndex ? { ...seg, color: 'yellow' } : seg)))} />
      )}
    </Box>
  );
}
```
- `OPPONENT_NICK_CAP`은 `OPPONENT_WIDTH - 14`로 바꾸고 주석에 " +NN" 4칸을 더한다.
- `OneCardView` 시그니처에 `focus, sendFocus`를 받고, 본문에서:
```tsx
  // 내 차례에 낼 수 있을 때만 "몇 번째 카드를 보고 있는지"를 알린다(카드 내용은 보내지 않는다).
  useFocusBroadcast(sendFocus, canPlayAction && hand.length > 0 ? { index: cursor } : null, view);

  function focusIndexOf(o: OtherPlayer): number | null {
    const index = o.isTurn ? (focus?.[o.nickname] as { index?: unknown } | undefined)?.index : undefined;
    return typeof index === 'number' ? index : null;
  }
```
  그리고 `<OpponentHand key={o.nickname} player={o} focusIndex={focusIndexOf(o)} theme={theme} />`.

`DavinciView.tsx`:
- import: `import { useFocusBroadcast } from '../focus.js';`
- 시그니처에 `focus, sendFocus` 추가.
- `selected` 계산 뒤:
```tsx
  useFocusBroadcast(sendFocus, selected !== undefined ? { player: selected.board.nickname, index: selected.index } : null, view);

  // 차례인 다른 사람이 겨누는 타일. 내 선택과 동시에 있을 수 없다(차례는 한 명).
  const others = v.turnPlayer !== null && v.turnPlayer !== undefined && v.turnPlayer !== you ? v.turnPlayer : null;
  const rawFocus = others !== null ? (focus?.[others] as { player?: unknown; index?: unknown } | undefined) : undefined;
  const aimed = rawFocus !== undefined && typeof rawFocus.player === 'string' && typeof rawFocus.index === 'number'
    ? { player: rawFocus.player, index: rawFocus.index }
    : null;
```
- 보드 map에서 `selectedIndex` 계산을 바꾼다:
```tsx
        const mine = selected !== undefined && selected.board.nickname === board.nickname ? selected.index : null;
        const theirs = aimed !== null && aimed.player === board.nickname ? aimed.index : null;
        const selectedIndex = mine ?? theirs;
```
  세그먼트 색: `color={seg.selected ? (mine !== null ? 'cyan' : 'magenta') : seg.kind === 'revealed' ? 'yellow' : undefined}`.
- 보드 목록 Box 바로 뒤, 내 선택 안내 앞에:
```tsx
      {aimed !== null && others !== null && (
        <Box marginTop={1}>
          {aimed.player === you ? (
            <Text bold color="magenta">{others}님이 내 {aimed.index + 1}번 타일을 노리고 있습니다!</Text>
          ) : (
            <Text color="magenta">{others}님이 {aimed.player}님의 {aimed.index + 1}번 타일을 노리는 중</Text>
          )}
        </Box>
      )}
```

- [ ] **Step 4: 통과 확인** — `cd packages/client && npx vitest run test/onecard-view.test.tsx test/davinci-view.test.tsx` → PASS(기존 ascii 순수성 테스트 포함).

- [ ] **Step 5: 커밋**
```bash
git add packages/client/src/ui/game/CardRows.tsx packages/client/src/ui/game/OneCardView.tsx packages/client/src/ui/game/DavinciView.tsx packages/client/test/onecard-view.test.tsx packages/client/test/davinci-view.test.tsx
git commit -m "feat(client): share and show focus in one card and davinci"
```

### Task 6: 야추·마피아 커서 전송과 표시

**Files:**
- Modify: `packages/client/src/ui/game/YachtView.tsx`, `packages/client/src/ui/game/MafiaView.tsx`
- Test: `packages/client/test/yacht-view.test.tsx`, `packages/client/test/mafia-view.test.tsx`(없으면 생성)

**Interfaces:**
- Consumes: `useFocusBroadcast`, `GameViewProps.focus/sendFocus`, `cursorGlyph`, `sep`(glyphs.ts). 야추 target `{ category }`, 마피아 `{ target }`.

- [ ] **Step 1: 실패하는 테스트 추가**

`yacht-view.test.tsx`:
```tsx
  it('차례인 다른 사람이 고민 중인 칸을 점수표와 문구로 보여주고, 표 줄 수는 그대로다', () => {
    const view = turnView({ yourActions: [], turnPlayer: '영희', players: turnView().players.map((p) => ({ ...p, isTurn: p.nickname === '영희' })) });
    const plain = render(<YachtView {...baseProps({ view })} />);
    const focused = render(<YachtView {...baseProps({ view, focus: { 영희: { category: 'fullHouse' } } })} />);
    const frame = focused.lastFrame() ?? '';
    expect(frame).toContain('풀하우스 칸을 고민 중');
    expect(frame.split('\n').find((l) => l.includes('풀하우스') && !l.includes('고민'))).toContain('▶');
    expect(frame.split('\n').length).toBe((plain.lastFrame() ?? '').split('\n').length);
    plain.unmount();
    focused.unmount();
  });

  it('점수 칸 선택 모드에서 커서 칸을 sendFocus로 보내고, 모드를 나가면 null을 보낸다', async () => {
    const sendFocus = vi.fn();
    const { stdin, unmount } = render(<YachtView {...baseProps({ sendFocus })} />);
    await tick();
    stdin.write('c');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sendFocus).toHaveBeenLastCalledWith({ category: 'twos' }); // 철수는 ones를 이미 기록했다
    stdin.write('\u001B');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sendFocus).toHaveBeenLastCalledWith(null);
    unmount();
  });
```
`mafia-view.test.tsx`(새 파일):
```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { MafiaView } from '../src/ui/game/MafiaView.js';
import type { GameViewProps } from '../src/ui/game/types.js';
import { findNonAsciiNonHangul } from './testUtils.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function nightView(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'night',
    yourActions: ['mafiaVote'],
    yourRole: 'mafia',
    phaseLabel: '밤',
    alive: [
      { nickname: '철수', alive: true },
      { nickname: '영희', alive: true },
      { nickname: '민수', alive: true },
      { nickname: '지민', alive: false, role: 'citizen' },
    ],
    hasActed: false,
    ...overrides,
  };
}

function baseProps(overrides: Partial<GameViewProps> = {}): GameViewProps {
  return { view: nightView(), you: '철수', send: vi.fn(), theme: { unicode: true }, ...overrides };
}

describe('MafiaView', () => {
  it('동료 마피아의 조준을 대상 옆에 표시한다', () => {
    const { lastFrame, unmount } = render(<MafiaView {...baseProps({ focus: { 영희: { target: '민수' } } })} />);
    const line = (lastFrame() ?? '').split('\n').find((l) => l.includes('민수'))!;
    expect(line).toContain('동료 영희 조준');
    unmount();
  });

  it('밤에 마피아로 고르는 대상을 sendFocus로 보낸다', async () => {
    const sendFocus = vi.fn();
    const { unmount } = render(<MafiaView {...baseProps({ sendFocus })} />);
    await tick();
    expect(sendFocus).toHaveBeenCalledWith({ target: '영희' });
    unmount();
  });

  it('낮 투표 커서는 보내지 않는다', async () => {
    const sendFocus = vi.fn();
    const view = nightView({ phase: 'day', phaseLabel: '낮', yourActions: ['vote'] });
    const { unmount } = render(<MafiaView {...baseProps({ view, sendFocus })} />);
    await tick();
    expect(sendFocus).not.toHaveBeenCalled();
    unmount();
  });

  it('--ascii 테마에서 ASCII·한글 외 문자가 새지 않는다', () => {
    const { lastFrame, unmount } = render(<MafiaView {...baseProps({ theme: { unicode: false }, focus: { 영희: { target: '민수' } } })} />);
    expect(findNonAsciiNonHangul(lastFrame() ?? '')).toEqual([]);
    unmount();
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd packages/client && npx vitest run test/yacht-view.test.tsx test/mafia-view.test.tsx` → 새 테스트 FAIL. (마피아 ascii 테스트는 기존 문구의 `—`·`·`·`↑↓` 때문에도 실패한다.)

- [ ] **Step 3: 구현**

`YachtView.tsx`:
- import: `import { useFocusBroadcast } from '../focus.js'; import { cursorGlyph } from './glyphs.js';`
- 시그니처에 `focus, sendFocus` 추가.
- `cursorCat` 계산 뒤:
```tsx
  useFocusBroadcast(sendFocus, cursorCat !== undefined ? { category: cursorCat } : null, view);

  // 차례인 다른 사람이 점수 칸 선택 모드에서 보고 있는 칸.
  const focusCategory = ((): YachtCategory | undefined => {
    if (v.turnPlayer === null || v.turnPlayer === you) return undefined;
    const category = (focus?.[v.turnPlayer] as { category?: unknown } | undefined)?.category;
    return typeof category === 'string' && (CATEGORY_ORDER as string[]).includes(category) ? (category as YachtCategory) : undefined;
  })();
```
- 카테고리 행: `const isFocusRow = focusCategory === cat;`를 추가하고 `bold={isCursorRow || isFocusRow}`, 마커는 `isCursorRow ? turnGlyph : isFocusRow ? cursorGlyph(theme) : ' '`.
- 주사위 칸의 `{v.turnPlayer}님의 차례` Text 아래:
```tsx
          {focusCategory !== undefined && v.turnPlayer !== null && (
            <Text color="yellow" wrap="truncate-end">
              {v.turnPlayer}님이 {CATEGORY_LABELS[focusCategory]} 칸을 고민 중
            </Text>
          )}
```
  (왼쪽 칸은 8줄, 점수표는 17줄이라 한 줄 늘어도 전체 높이는 그대로다.)

`MafiaView.tsx`:
- import: `import { useFocusBroadcast } from '../focus.js'; import { cursorGlyph, sep } from './glyphs.js';`
- 시그니처에 `focus, sendFocus` 추가.
- `cursor` state 선언 뒤:
```tsx
  // 밤의 마피아 조준만 보낸다 — 낮 투표 커서는 숨긴다(스펙). 서버도 한 번 더 막는다.
  const aiming = canAct && action === 'mafiaVote' ? targets[Math.min(cursor, targets.length - 1)] : undefined;
  useFocusBroadcast(sendFocus, aiming !== undefined ? { target: aiming.nickname } : null, view);

  /** 이 대상을 겨누고 있는 동료 마피아들. */
  function comradesAiming(nickname: string): string[] {
    return Object.entries(focus ?? {})
      .filter(([, t]) => (t as { target?: unknown } | null)?.target === nickname)
      .map(([from]) => from);
  }
```
- `const pointer = theme.unicode ? '▶' : '>';`를 `const pointer = cursorGlyph(theme);`로 바꾼다.
- 참가자 줄의 생존/탈락 표기 뒤에:
```tsx
              {comradesAiming(p.nickname).length > 0 && (
                <Text color="red"> {theme.unicode ? '←' : '<-'} 동료 {comradesAiming(p.nickname).join(', ')} 조준</Text>
              )}
```
- ascii 누출 수정: `phaseLabel — phaseText`의 `—`를 `:`로, 안내 `'↑↓ 대상 선택 · Enter 확정'`을
  `` `${theme.unicode ? '↑↓' : '위/아래'} 대상 선택${sep(theme)}Enter 확정` ``로 바꾼다.

- [ ] **Step 4: 통과 확인** — `cd packages/client && npx vitest run test/yacht-view.test.tsx test/mafia-view.test.tsx` → PASS.

- [ ] **Step 5: 전체 검증** — 루트에서 `npx vitest run` → 전부 PASS, `npm run typecheck` → 오류 없음, `npm run build` → 성공.

- [ ] **Step 6: 커밋**
```bash
git add packages/client/src/ui/game/YachtView.tsx packages/client/src/ui/game/MafiaView.tsx packages/client/test/yacht-view.test.tsx packages/client/test/mafia-view.test.tsx
git commit -m "feat(client): share and show focus in yacht and mafia"
```

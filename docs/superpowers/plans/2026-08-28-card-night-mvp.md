# soft-puzzle MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LAN에서 즐기는 CLI 멀티플레이 카드 게임 MVP — 공통 인프라(로비·TCP/UDP·TUI) + 블랙잭·원카드·야추 3종.

**Architecture:** 방장 프로세스가 서버를 겸하는 서버 권위(server-authoritative) 구조. 게임 로직은 전부 `core`의 순수 상태머신이고, `server`는 공통 `GameEngine` 인터페이스로만 게임을 진행하며 각 플레이어에게 개인화된 상태 스냅샷을 보낸다. `client`는 스냅샷을 그대로 그리는 Ink 기반 TUI 렌더러다.

**Tech Stack:** Node 22+, TypeScript 5.x (ESM), npm workspaces 모노레포, vitest, Ink 5 + React 18, ink-testing-library, tsup(배포 번들).

**Spec:** `docs/superpowers/specs/2026-08-28-cli-card-game-design.md`

## Global Constraints

- Node >= 22, TypeScript 5.x, `"type": "module"` (ESM). CommonJS 금지.
- 모노레포: npm workspaces, 패키지는 `packages/core`, `packages/server`, `packages/client` 3개. `core`는 Node 내장 모듈 외 런타임 의존성 0개.
- 테스트 러너는 vitest. 루트에서 `npm test`로 전체 실행, `npm test -w packages/core`로 패키지 단위 실행.
- 포트: 게임 TCP `7420`, 발견 UDP `7421`. 사용 중이면 +1 하며 최대 10회 재시도.
- 프로토콜: TCP 위 NDJSON (JSON 한 줄 = 메시지 한 개, UTF-8, `\n` 구분).
- 방 최대 인원 6명. 턴 제한시간 90초(90_000ms) — 초과 시 `defaultAction` 자동 적용.
- 카드 표기: 문자열 2글자 `"KH"`(랭크+무늬 S/H/D/C), 조커는 `"JB"`(흑)/`"JR"`(적).
- 사용자에게 보이는 모든 문구는 한국어.
- 커밋: conventional commits(`feat:`/`test:`/`chore:` …), 본문 끝에 다음 푸터를 붙인다.
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 셔플·주사위 등 모든 무작위성은 주입된 `Rng`만 사용한다. `Math.random()` 직접 호출 금지.

## File Structure

```
soft-puzzle/
├── package.json                  # workspaces 루트, scripts: test/build/typecheck
├── tsconfig.base.json
├── vitest.workspace.ts
└── packages/
    ├── core/src/
    │   ├── rng.ts                # 시드 RNG(mulberry32), shuffle
    │   ├── card.ts               # Card 타입, 덱 생성, suitOf/rankOf/isRed
    │   ├── protocol.ts           # ClientMsg/ServerMsg/RoomInfo 타입
    │   ├── ndjson.ts             # NDJSON 인코더/스트림 디코더 (서버·클라 공용)
    │   ├── engine.ts             # GameEngine 인터페이스, GameView, GameId
    │   └── games/
    │       ├── blackjack.ts      # handValue + BlackjackEngine
    │       ├── yacht.ts          # scoreCategory + YachtEngine
    │       └── onecard.ts        # canPlay + OneCardEngine
    ├── server/src/
    │   ├── room.ts               # 로비/게임 수명주기, 개인화 뷰 브로드캐스트, 타이머
    │   ├── server.ts             # TCP NDJSON 서버 (소켓↔Room 연결)
    │   └── discovery.ts          # UDP 방 알림 응답기
    └── client/src/
        ├── index.tsx             # bin 엔트리, --ascii 플래그, Ink render
        ├── config.ts             # ~/.soft-puzzle.json (닉네임 저장)
        ├── net/connection.ts     # TCP 클라이언트 (Connection)
        ├── net/discover.ts       # UDP 브로드캐스트 스캔
        ├── art/theme.ts          # 유니코드/ascii 모드 감지
        ├── art/cards.ts          # 카드 ASCII 아트 (7×5, 겹침)
        ├── art/dice.ts           # 주사위 ASCII 아트 (9×5, 홀드)
        └── ui/
            ├── App.tsx           # 화면 라우팅 상태머신
            ├── screens/          # Nickname, MainMenu, RoomList, Lobby, Result, Disconnected
            └── game/             # BlackjackView, OneCardView, YachtView, ActionBar
```

테스트는 각 패키지의 `test/` 디렉토리에 소스와 같은 이름으로 둔다 (`packages/core/test/blackjack.test.ts` 등).

---

### Task 1: 모노레포 스캐폴드

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`
- Create: `packages/{core,server,client}/package.json`, `packages/{core,server,client}/tsconfig.json`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Consumes: 없음 (최초 태스크)
- Produces: 이후 모든 태스크가 쓰는 빌드/테스트 파이프라인. 패키지명 `@soft-puzzle/core`, `@soft-puzzle/server`, `@soft-puzzle/client`. `server`·`client`는 `@soft-puzzle/core`에, `client`는 `@soft-puzzle/server`에도 workspace 의존.

- [ ] **Step 1: 루트/패키지 설정 파일 작성**

루트 `package.json`:

```json
{
  "name": "soft-puzzle-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --build packages/core packages/server packages/client"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "composite": true, "declaration": true,
    "jsx": "react", "skipLibCheck": true, "outDir": "dist", "rootDir": "src"
  }
}
```

각 패키지 `package.json`은 `{"name": "@soft-puzzle/core", "type": "module", "exports": {".": "./src/index.ts"}}` 형태(개발 중엔 소스 직접 참조, vitest가 TS를 처리). `server`는 dependencies에 `"@soft-puzzle/core": "*"`, `client`는 `"@soft-puzzle/core": "*", "@soft-puzzle/server": "*"`. 각 패키지 `tsconfig.json`은 `../../tsconfig.base.json`을 extends 하고 references로 의존 패키지를 가리킨다. `vitest.workspace.ts`는 `export default ['packages/*']`. `.gitignore`: `node_modules/`, `dist/`.

- [ ] **Step 2: 스모크 테스트 작성**

```ts
// packages/core/test/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('workspace', () => {
  it('runs tests', () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 3: 설치 및 실행 검증**

Run: `npm install && npm test && npm run typecheck`
Expected: 스모크 테스트 1개 PASS, typecheck 에러 0 (core에 빈 `src/index.ts` 필요).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: npm workspaces 모노레포 스캐폴드 (core/server/client)"
```

---

### Task 2: core — 시드 RNG와 카드/덱

**Files:**
- Create: `packages/core/src/rng.ts`, `packages/core/src/card.ts`
- Modify: `packages/core/src/index.ts` (re-export)
- Test: `packages/core/test/rng.test.ts`, `packages/core/test/card.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type Rng = () => number` (0 이상 1 미만), `mulberry32(seed: number): Rng`, `shuffle<T>(arr: readonly T[], rng: Rng): T[]` (원본 불변, Fisher-Yates)
  - `type Suit = 'S'|'H'|'D'|'C'`, `type Card = string` (`"KH"`, `"10D"`, 조커 `"JB"|"JR"`)
  - `makeDeck(opts?: { jokers?: boolean }): Card[]` — 52장, `jokers: true`면 54장
  - `suitOf(c: Card): Suit | null` (조커는 null), `rankOf(c: Card): string` (`"A".."K"` 또는 `"JOKER"`), `isRed(c: Card): boolean` (H/D/JR = true)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// packages/core/test/rng.test.ts
import { mulberry32, shuffle } from '../src/rng.js';
it('같은 시드는 같은 셔플 결과', () => {
  const a = shuffle([1,2,3,4,5], mulberry32(42));
  const b = shuffle([1,2,3,4,5], mulberry32(42));
  expect(a).toEqual(b);
  expect(a.slice().sort()).toEqual([1,2,3,4,5]); // 원소 보존
});
it('원본을 변경하지 않는다', () => {
  const src = [1,2,3]; shuffle(src, mulberry32(1));
  expect(src).toEqual([1,2,3]);
});
```

```ts
// packages/core/test/card.test.ts
import { makeDeck, suitOf, rankOf, isRed } from '../src/card.js';
it('조커 없는 덱은 52장, 중복 없음', () => {
  const d = makeDeck();
  expect(d).toHaveLength(52);
  expect(new Set(d).size).toBe(52);
});
it('조커 덱은 54장이고 JB/JR 포함', () => {
  const d = makeDeck({ jokers: true });
  expect(d).toHaveLength(54);
  expect(d).toContain('JB'); expect(d).toContain('JR');
});
it('카드 속성 판정', () => {
  expect(suitOf('KH')).toBe('H'); expect(suitOf('JB')).toBeNull();
  expect(rankOf('10D')).toBe('10'); expect(rankOf('JR')).toBe('JOKER');
  expect(isRed('JR')).toBe(true); expect(isRed('AS')).toBe(false);
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test -w packages/core`. Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

```ts
// packages/core/src/rng.ts
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

`card.ts`: `RANKS = ['A','2',...,'10','J','Q','K']`, `SUITS = ['S','H','D','C']` 이중 루프로 덱 생성. `suitOf`는 마지막 글자, `rankOf`는 나머지(조커 'JB'/'JR'는 특수 분기 — 'J'+'B'가 랭크 J로 오인되지 않도록 조커 판정을 먼저 한다). `index.ts`에서 전부 re-export.

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test -w packages/core`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): 시드 RNG와 카드/덱 모듈"`

---

### Task 3: core — 프로토콜 타입과 NDJSON 코덱

**Files:**
- Create: `packages/core/src/protocol.ts`, `packages/core/src/ndjson.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ndjson.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Card`
- Produces (이후 server/client가 그대로 사용):

```ts
// protocol.ts — 전체를 여기 정의된 그대로 구현
export type GameId = 'blackjack' | 'onecard' | 'yacht';
export type ClientMsg =
  | { type: 'join'; nickname: string }
  | { type: 'action'; name: string; arg?: unknown }
  | { type: 'chat'; text: string };
export interface GameView { phase: string; yourActions: string[]; [k: string]: unknown }
export type ServerMsg =
  | { type: 'joined'; you: string }
  | { type: 'error'; code: 'full' | 'dup' | 'playing' | 'bad-msg'; message: string }
  | { type: 'state'; phase: 'lobby' | 'playing' | 'result';
      room: { name: string; game: GameId; host: string; players: string[] };
      view?: GameView;
      result?: { ranking: { nickname: string; detail: string }[] } }
  | { type: 'event'; text: string };
export interface RoomInfo { room: string; game: GameId; players: string; addr: string }
export const DISCOVERY_PROBE = 'WHO_IS_THERE';
export const DEFAULT_TCP_PORT = 7420;
export const DEFAULT_UDP_PORT = 7421;
export const TURN_TIMEOUT_MS = 90_000;
export const MAX_PLAYERS = 6;
```

  - `encodeMsg(msg: object): string` — `JSON.stringify(msg) + '\n'`
  - `class NdjsonDecoder { push(chunk: Buffer | string): unknown[] }` — 청크 누적, 완성된 줄만 파싱해 반환. 파싱 실패 줄은 무시(버림).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// packages/core/test/ndjson.test.ts
import { encodeMsg, NdjsonDecoder } from '../src/ndjson.js';
it('쪼개진 청크를 이어붙여 메시지 단위로 파싱한다', () => {
  const d = new NdjsonDecoder();
  expect(d.push('{"type":"jo')).toEqual([]);
  expect(d.push('in","nickname":"철수"}\n{"type":"chat"')).toEqual([
    { type: 'join', nickname: '철수' },
  ]);
  expect(d.push(',"text":"ㄱㄱ"}\n')).toEqual([{ type: 'chat', text: 'ㄱㄱ' }]);
});
it('깨진 JSON 줄은 무시한다', () => {
  const d = new NdjsonDecoder();
  expect(d.push('not-json\n{"type":"chat","text":"hi"}\n'))
    .toEqual([{ type: 'chat', text: 'hi' }]);
});
it('encodeMsg는 개행으로 끝난다', () => {
  expect(encodeMsg({ a: 1 })).toBe('{"a":1}\n');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -w packages/core`. Expected: FAIL.

- [ ] **Step 3: 구현** — `protocol.ts`는 위 Produces의 코드를 그대로. `NdjsonDecoder`는 내부 `buf: string`에 누적 후 `\n` 기준 split, 마지막 조각은 버퍼에 보관. `try { JSON.parse } catch { continue }`.

- [ ] **Step 4: 통과 확인** — Run: `npm test -w packages/core`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): 프로토콜 타입과 NDJSON 코덱"`

---

### Task 4: core — GameEngine 인터페이스 + 블랙잭

**Files:**
- Create: `packages/core/src/engine.ts`, `packages/core/src/games/blackjack.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/blackjack.test.ts`

**Interfaces:**
- Consumes: Task 2 (`Card`, `Rng`, `makeDeck`, `shuffle`), Task 3 (`GameView`, `GameId`)
- Produces — **모든 게임이 구현하는 공통 인터페이스** (server의 Room은 이것만 안다):

```ts
// engine.ts — 이 코드 그대로 구현
import type { Rng } from './rng.js';
import type { GameId, GameView } from './protocol.js';
export interface EngineEvent { text: string }           // 딜러 멘트/알림 → event 메시지로 전달
export interface EngineAction { name: string; arg?: unknown }
export interface GameEngine {
  readonly game: GameId;
  readonly minPlayers: number;
  start(players: string[], host: string, rng: Rng): void;
  handleAction(player: string, action: EngineAction): EngineEvent[]; // 무효 액션이면 [] 반환, 상태 불변
  getViewFor(player: string): GameView;
  pendingPlayers(): string[];                            // 지금 입력을 기다리는 플레이어들
  defaultAction(player: string): EngineAction | null;    // 타임아웃 자동 처리용
  removePlayer(player: string): EngineEvent[];           // 이탈 처리
  isFinished(): boolean;
  result(): { ranking: { nickname: string; detail: string }[] } | null; // 종료 전엔 null
}
```

  - `handValue(cards: Card[]): { total: number; soft: boolean }` — A는 1/11 유리한 쪽
  - `class BlackjackEngine implements GameEngine` — `minPlayers = 2`

**블랙잭 상태머신 명세** (스펙 §6):
- phase: `betting` → `acting` → `settle` → (전원 ready 시) `betting` … / (host의 endGame 시) 종료.
- `betting`: 전원 시작 칩 1000. 액션 `bet`(arg: 10 이상 보유칩 이하 10 단위 정수). 칩 0인 플레이어는 자동 관전(pending에서 제외). 전원 베팅 완료 시 딜 — 각자 2장, 딜러 2장(1장 공개) 후 `acting`.
- `acting`: 턴 순서대로 `hit`/`stand`, 첫 2장 + 칩이 베팅액만큼 더 있으면 `double`(베팅 2배, 1장만 받고 자동 스탠드). 21 초과 시 버스트(자동 스탠드). 블랙잭(첫 2장 21)은 자동 스탠드. 전원 종료 시 딜러 자동 진행: 소프트 17 포함 17 이상까지 히트하지 않음(= 16 이하만 히트), 그 뒤 `settle`.
- `settle`: 정산 — 버스트 패배(베팅 상실), 딜러 버스트 시 생존자 승리(베팅만큼 획득), 그 외 숫자 비교(무승부는 반환), 플레이어 블랙잭 승리는 1.5배(딜러도 블랙잭이면 무승부). 액션: 전원 `ready`, host는 추가로 `endGame`. 전원 ready → 다음 라운드 `betting`(칩 유지). endGame → `isFinished() = true`, `result()`는 칩 많은 순 랭킹(detail: `"칩 1,450"`).
- `defaultAction`: betting에선 `{name:'bet', arg:10}`(칩 10 미만이면 관전 전환), acting에선 `{name:'stand'}`, settle에선 `{name:'ready'}`.
- `removePlayer`: acting 중이면 stand 처리 후 명단 제거, 이후 라운드 제외. 남은 인원 1명이면 즉시 종료.
- `getViewFor`: `you`(내 패 전체·칩·베팅), `others`(닉·패 장수·acting에선 공개 패—블랙잭은 전통적으로 전원 공개이므로 남의 패도 카드 자체를 공개, 칩·isTurn), `dealer`(공개 카드, 숨김 장수; settle에선 전체 공개), `yourActions`.
- 모든 상태 전이는 `EngineEvent[]`로 딜러 멘트를 낸다. 예: `"딜러: 카드를 돌립니다."`, `"철수님 버스트! (23)"`.

- [ ] **Step 1: handValue 실패 테스트 작성**

```ts
// packages/core/test/blackjack.test.ts
import { handValue, BlackjackEngine } from '../src/games/blackjack.js';
import { mulberry32 } from '../src/rng.js';
it.each([
  [['KH','7D'], 17, false],
  [['AS','KD'], 21, true],     // 블랙잭
  [['AS','AD','9C'], 21, true],
  [['AS','AD','AC','8H','KD'], 21, false], // A 전부 1
  [['KH','QD','5S'], 25, false],
])('handValue(%j) = %i (soft=%s)', (cards, total, soft) => {
  expect(handValue(cards as string[])).toEqual({ total, soft });
});
```

- [ ] **Step 2: 실패 확인 → handValue 구현 → 통과 확인**

```ts
export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 'A') { aces++; total += 1; }
    else if (['K','Q','J'].includes(r)) total += 10;
    else total += Number(r);
  }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) { total += 10; soft = true; }
  return { total, soft };
}
```

- [ ] **Step 3: 엔진 시나리오 실패 테스트 작성** — 시드 RNG로 결정적 진행. 최소 다음 케이스:

```ts
function startGame(seed = 1) {
  const e = new BlackjackEngine();
  e.start(['철수','영희'], '철수', mulberry32(seed));
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
  for (const p of ['철수','영희']) e.handleAction(p, { name: 'stand' });
  const v = e.getViewFor('철수');
  expect(v.phase).toBe('settle');
  expect((v.dealer as any).hiddenCount).toBe(0);       // 전체 공개
  const chips = (v.you as any).chips;
  expect([900, 1000, 1100, 1150]).toContain(chips);     // 패/무/승/블랙잭승
});
it('host의 endGame으로 종료되고 칩 순 랭킹이 나온다', () => { /* settle까지 진행 후 */ });
it('베팅액이 칩을 초과하면 무시된다', () => { /* bet 5000 → [] */ });
it('이탈 후 1명 남으면 즉시 종료', () => { /* removePlayer('영희') → isFinished true */ });
```

(주석 처리된 케이스도 모두 실제 코드로 작성한다 — 위 두 케이스와 같은 요령으로 settle까지 진행시키는 헬퍼 `advanceToSettle(e)`를 만들어 재사용.)

- [ ] **Step 4: 실패 확인 → BlackjackEngine 구현 → 통과 확인** — 위 명세의 규칙을 전부 구현. 내부 상태는 `{ deck, phase, order: string[], turnIdx, seats: Map<string, {hand, chips, bet, done, spectating}>, dealerHand, ready: Set<string> }`. Run: `npm test -w packages/core`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): GameEngine 인터페이스와 블랙잭 엔진"`

---

### Task 5: core — 야추

**Files:**
- Create: `packages/core/src/games/yacht.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/yacht.test.ts`

**Interfaces:**
- Consumes: Task 4의 `GameEngine`/`EngineAction`/`EngineEvent`, Task 2의 `Rng`
- Produces:
  - `type YachtCategory = 'ones'|'twos'|'threes'|'fours'|'fives'|'sixes'|'threeKind'|'fourKind'|'fullHouse'|'smallStraight'|'largeStraight'|'yacht'|'chance'`
  - `scoreCategory(dice: number[], cat: YachtCategory): number` (순수 함수)
  - `class YachtEngine implements GameEngine` — `minPlayers = 1`

**야추 명세** (스펙 §6): 턴 = 주사위 5개 자동 1회 굴림으로 시작, 이후 `toggleHold`(arg: 0~4 인덱스), `reroll`(홀드 안 된 것만 다시, 턴당 reroll 최대 2회 → 총 3회 굴림), `score`(arg: 아직 안 쓴 카테고리). score 시 다음 사람 턴, 전원이 13칸을 다 채우면 종료. 상단(ones~sixes) 합 63 이상이면 +35. `result()`는 총점 순 랭킹(detail: `"178점"`). 점수 규칙: threeKind/fourKind = 같은 눈 3/4개 이상일 때 전체 합(아니면 0), fullHouse = 3+2 조합(5개 동일 포함) 25, smallStraight = 4연속 30, largeStraight = 5연속 40, yacht = 5개 동일 50, chance = 전체 합. `defaultAction`: `{name:'score', arg:'chance'}` — chance가 이미 쓰였으면 남은 카테고리 중 점수가 가장 높은 것. `getViewFor`: 전원의 점수표(공개 정보), 현재 턴 플레이어의 주사위·홀드·남은 굴림 수.

- [ ] **Step 1: scoreCategory 실패 테스트 작성**

```ts
it.each([
  [[1,1,2,3,4], 'ones', 2], [[6,6,6,2,2], 'sixes', 18],
  [[3,3,3,2,5], 'threeKind', 16], [[3,3,2,2,5], 'threeKind', 0],
  [[4,4,4,4,2], 'fourKind', 18],
  [[2,2,3,3,3], 'fullHouse', 25], [[5,5,5,5,5], 'fullHouse', 25], [[2,2,3,3,4], 'fullHouse', 0],
  [[1,2,3,4,6], 'smallStraight', 30], [[2,3,4,5,6], 'smallStraight', 30], [[1,2,3,5,6], 'smallStraight', 0],
  [[1,2,3,4,5], 'largeStraight', 40], [[1,2,3,4,6], 'largeStraight', 0],
  [[4,4,4,4,4], 'yacht', 50], [[1,3,5,2,6], 'chance', 17],
])('scoreCategory(%j, %s) = %i', (dice, cat, expected) => {
  expect(scoreCategory(dice as number[], cat as YachtCategory)).toBe(expected);
});
```

- [ ] **Step 2: 실패 확인 → scoreCategory 구현 → 통과 확인**

- [ ] **Step 3: 엔진 실패 테스트 작성** — 케이스: ① 시작하면 첫 플레이어 주사위 5개가 굴려져 있고 rollsLeft 2 ② reroll은 홀드 안 된 주사위만 바꾼다(시드 고정으로 검증) ③ reroll 2회 후 `yourActions`에 reroll이 없다 ④ 이미 쓴 카테고리에 score 하면 무시 ⑤ 상단 63점 이상이면 보너스 35가 총점에 더해진다(엔진 내부 점수표를 직접 채우는 테스트용 헬퍼 대신, 시드를 골라 진행하거나 상단 항목만 13턴 진행하는 결정적 시나리오로) ⑥ 혼자(1인) 플레이 가능 ⑦ 13칸 모두 채우면 `isFinished()`와 총점 랭킹.

- [ ] **Step 4: 실패 확인 → YachtEngine 구현 → 통과 확인** — 내부 상태 `{ order, turnIdx, dice: number[5], held: boolean[5], rollsLeft, sheets: Map<string, Partial<Record<YachtCategory, number>>> }`.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): 야추 엔진과 점수 계산"`

---

### Task 6: core — 원카드

**Files:**
- Create: `packages/core/src/games/onecard.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/onecard.test.ts`

**Interfaces:**
- Consumes: Task 4의 `GameEngine` 계열, Task 2의 카드 유틸
- Produces:
  - `canPlay(card: Card, top: Card, declaredSuit: Suit | null, attackStack: number): boolean` (순수 함수)
  - `class OneCardEngine implements GameEngine` — `minPlayers = 2`

**원카드 명세** (스펙 §6, 고정 룰):
- 54장(조커 포함), 시작 7장. 액션: `play`(arg: `{ card: Card; declareSuit?: Suit }` — 7을 낼 때만 declareSuit 필수), `draw`.
- 일반 규칙: 같은 무늬 또는 같은 랭크. 7 선언 후엔 선언 무늬가 기준. 조커가 바닥이고 공격이 해소된 뒤엔 아무 카드나 가능.
- 공격: 2(+2), A(+3), JB(+5), JR(+7). 공격 스택 > 0이면 같은 종류로만 되받기(2↔2, A↔A, 조커↔조커 흑/적 무관). **3 방어 없음.** 되받지 못하면 `draw`로 스택 전부 드로우 후 턴 종료(스택 0으로).
- 조커 색 제약: JB는 바닥이 검정(♠♣) 또는 조커일 때만, JR은 빨강(♥♦) 또는 조커일 때만.
- 기능: J = 다음 사람 건너뜀, Q = 방향 전환(2인전에선 효과 없음), K = 한 번 더(같은 플레이어 턴 유지).
- 드로우 더미 소진 시 버린 더미(top 제외)를 재셔플. 손패 15장 이상이면 파산 탈락(탈락 순서 역순으로 하위 랭킹).
- 손패 0 = 완주(완주 순서로 상위 랭킹). 남은 인원 1명이면 종료. `defaultAction`: `{name:'draw'}`.
- `getViewFor`: `you.hand` 전체, `others`는 닉·장수·isTurn만(**패 내용 비공개**), `top`, `declaredSuit`, `attackStack`, `direction`.

- [ ] **Step 1: canPlay 실패 테스트 작성**

```ts
it.each([
  ['KH', 'KD', null, 0, true],   // 같은 랭크
  ['KH', '2H', null, 0, true],   // 같은 무늬
  ['KH', '2D', null, 0, false],
  ['KH', '7S', 'H',  0, true],   // 7 선언 무늬 따름
  ['2H', '2D', null, 2, true],   // 공격 되받기: 2 위에 2
  ['AH', '2D', null, 2, false],  // 2 공격에 A로 응수 불가
  ['3H', '2H', null, 2, false],  // 3 방어 없음
  ['JB', 'KS', null, 0, true],   // 흑조커는 검정 위 OK
  ['JB', 'KH', null, 0, false],
  ['JR', 'JB', null, 5, true],   // 조커 위 조커 (흑/적 무관)
  ['5H', 'JR', null, 0, true],   // 공격 해소된 조커 바닥 위엔 아무 카드
])('canPlay(%s on %s, declared=%s, stack=%i) = %s', (c, t, d, s, ok) => {
  expect(canPlay(c, t, d as Suit | null, s)).toBe(ok);
});
```

- [ ] **Step 2: 실패 확인 → canPlay 구현 → 통과 확인**

- [ ] **Step 3: 엔진 실패 테스트 작성** — 엔진에 테스트 전용 `setHands(hands: Map<string, Card[]>, top: Card)` 헬퍼를 두어 결정적 시나리오 구성(공개 API 아님을 주석으로 명시). 케이스: ① 시작 시 각자 7장 + top 1장 ② 낼 수 없는 카드 play는 무시 ③ 2를 내면 다음 사람 attackStack 2, 그 사람이 draw 하면 2장 받고 스택 0 ④ 공격 되받기 누적(2→2 = 스택 4) ⑤ J 스킵, Q 방향 전환(3인), K 턴 유지, 7 무늬 선언 ⑥ 마지막 카드를 털면 완주·랭킹 등록 ⑦ 15장 도달 시 파산 탈락 ⑧ 드로우 더미 소진 시 재셔플되어 draw 가능.

- [ ] **Step 4: 실패 확인 → OneCardEngine 구현 → 통과 확인** — 내부 상태 `{ order, turnIdx, direction: 1|-1, hands: Map, drawPile, discard, top, declaredSuit, attackStack, finished: string[], busted: string[] }`.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): 원카드 엔진 (고정 룰: 3방어 없음, 흑/적 조커 구분)"`

---

### Task 7: server — Room (로비·게임 수명주기·타이머)

**Files:**
- Create: `packages/server/src/room.ts`, `packages/server/src/index.ts`
- Test: `packages/server/test/room.test.ts`

**Interfaces:**
- Consumes: core의 `GameEngine` 3종, `ClientMsg`/`ServerMsg`, `TURN_TIMEOUT_MS`, `MAX_PLAYERS`, `mulberry32`
- Produces (Task 8의 TCP 서버와 Task 16의 호스트 모드가 사용):

```ts
export interface RoomOpts {
  name: string; game: GameId; host: string;
  rng?: Rng;            // 기본 mulberry32(Date.now())
  now?: () => number;   // 기본 Date.now — 테스트에서 fake clock 주입
}
export class Room {
  constructor(opts: RoomOpts);
  join(nickname: string): { ok: true } | { ok: false; code: 'full' | 'dup' | 'playing' };
  leave(nickname: string): void;
  handleMessage(nickname: string, msg: ClientMsg): void;   // action/chat 처리
  onSend(cb: (nickname: string, msg: ServerMsg) => void): void; // 개인별 송신 콜백
  checkTimeout(): void;   // 1초마다 호출됨 (server가 setInterval)
  info(): RoomInfo;       // discovery 응답용 ("2/6" 형식)
}
```

**Room 명세:**
- phase `lobby`: join/leave 시 전원에게 state 브로드캐스트. host가 `{type:'action',name:'start'}` 보내고 인원이 `engine.minPlayers` 이상이면 엔진 `start` 후 phase `playing`. host가 아니거나 인원 부족이면 무시하고 해당 유저에게 event로 사유 안내.
- phase `playing`: `action` 메시지를 `engine.handleAction`에 위임 → 반환된 `EngineEvent[]`를 전원에게 `event`로, 이어서 전원에게 개인화 `state`(`view: engine.getViewFor(닉)`) 송신. `engine.isFinished()`면 phase `result`로 전환하고 `result` 포함 state 송신.
- phase `result`: host의 `{name:'replay'}` → 같은 멤버·같은 게임으로 새 엔진 시작(칩 리셋). host의 `{name:'toLobby'}` → phase `lobby`.
- `chat`: `"[철수] ㄱㄱ"` 형식의 event로 전원 브로드캐스트.
- 타이머: playing 중 액션이 처리될 때마다 `deadline = now() + TURN_TIMEOUT_MS` 갱신. `checkTimeout()`에서 초과 시 `engine.pendingPlayers()` 각각에 `defaultAction` 적용하고 `"⏰ 시간 초과 — 자동 처리되었습니다"` event.
- `leave`: lobby면 명단 제거, playing이면 `engine.removePlayer` 후 이벤트·state 브로드캐스트. host가 나가면 아무것도 하지 않는다(서버 프로세스가 곧 죽으므로 — 참가자 클라이언트가 소켓 끊김으로 감지).

- [ ] **Step 1: 실패 테스트 작성** — 송신 기록용 `sent: Record<string, ServerMsg[]>`를 콜백으로 수집하는 헬퍼로 검증. 케이스: ① join 후 전원이 lobby state를 받는다 ② 7번째 join은 `{ok:false,code:'full'}` ③ 닉 중복은 `dup` ④ host가 아닌 사람의 start는 무시 ⑤ start 후 각자 받은 state.view가 다르다(블랙잭에서 내 hand만 카드 문자열, 남은 handCount) — **정보 격리 테스트** ⑥ fake clock을 90초 넘겨 `checkTimeout()` 호출 시 자동 처리 event가 나간다 ⑦ 게임 종료 시 result state, host replay 시 다시 playing.

```ts
function setup() {
  let t = 0;
  const room = new Room({ name: '철수의 방', game: 'blackjack', host: '철수',
    rng: mulberry32(7), now: () => t });
  const sent: Record<string, ServerMsg[]> = {};
  room.onSend((nick, msg) => { (sent[nick] ??= []).push(msg); });
  return { room, sent, tick: (ms: number) => { t += ms; room.checkTimeout(); } };
}
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -w packages/server`. Expected: FAIL.

- [ ] **Step 3: Room 구현** — 명세 전부. 엔진 생성은 `{ blackjack: () => new BlackjackEngine(), ... }` 팩토리 맵.

- [ ] **Step 4: 통과 확인** — Run: `npm test -w packages/server`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(server): Room 로비/게임 수명주기와 턴 타이머"`

---

### Task 8: server — TCP NDJSON 서버 + 실소켓 통합 테스트

**Files:**
- Create: `packages/server/src/server.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test/server.test.ts`

**Interfaces:**
- Consumes: Task 7 `Room`, core `NdjsonDecoder`/`encodeMsg`
- Produces:

```ts
export interface RunningServer { port: number; close(): Promise<void> }
export function startServer(room: Room, preferredPort?: number): Promise<RunningServer>
```

**명세:** `net.createServer`. 첫 메시지는 반드시 `join` — 성공 시 `{type:'joined',you:닉}` 응답 후 소켓↔닉 바인딩, 실패 시 error 송신 후 소켓 종료. 이후 메시지는 `room.handleMessage`로. 소켓 `close`/`error` 시 `room.leave`. `room.onSend`는 닉→소켓 맵으로 `encodeMsg` 송신. 포트 사용 중(EADDRINUSE)이면 +1 하며 최대 10회. 서버 기동 시 1초 `setInterval`로 `room.checkTimeout()` 호출(`close`에서 해제, `unref()` 적용).

- [ ] **Step 1: 실패 테스트 작성** — 테스트 헬퍼 `class TestClient`(net.Socket + NdjsonDecoder, `send(msg)`, `next(type?): Promise<ServerMsg>` — 수신 큐에서 꺼내는 async 헬퍼). 케이스: ① 두 클라이언트 접속 → 로비 → start → 블랙잭 베팅~settle 한 라운드 완주(각자 받은 마지막 state로 검증) ② **패 유출 없음**: 상대가 받은 어떤 state 메시지의 JSON 문자열에도 내 손패 카드가 등장하지 않음 — 원카드로 실행 (`JSON.stringify(msg)`에 상대 카드 문자열 포함 여부 검사; 상대 패는 handCount만) ③ join 없이 action 먼저 보내면 error 후 소켓 종료 ④ 소켓 강제 종료 시 남은 클라이언트에게 이탈 event 도착 ⑤ 포트 점유 시 +1로 기동.

- [ ] **Step 2: 실패 확인** — Run: `npm test -w packages/server`. Expected: FAIL.

- [ ] **Step 3: 구현** — 명세 전부. Run: `npm test -w packages/server`. Expected: PASS.

- [ ] **Step 4: 전체 회귀** — Run: `npm test`. Expected: 전부 PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(server): TCP NDJSON 서버와 실소켓 통합 테스트"`

---

### Task 9: 방 발견 — UDP 응답기(server) + 스캐너(client)

**Files:**
- Create: `packages/server/src/discovery.ts`, `packages/client/src/net/discover.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test/discovery.test.ts`

**Interfaces:**
- Consumes: core `RoomInfo`, `DISCOVERY_PROBE`, `DEFAULT_UDP_PORT`; Task 7 `room.info()`
- Produces:
  - `startDiscovery(getInfo: () => RoomInfo, port?: number): Promise<{ port: number; close(): void }>` — UDP 바인드(`reuseAddr: true`), `WHO_IS_THERE` 수신 시 발신자에게 `JSON.stringify(getInfo())` 응답. EADDRINUSE 시 +1 최대 10회.
  - `discoverRooms(opts?: { timeoutMs?: number; port?: number }): Promise<RoomInfo[]>` — 브로드캐스트(`255.255.255.255` + 각 인터페이스 브로드캐스트 주소)로 프로브를 1초 간격 3회 송신, 기본 3.5초 수집, `addr` 기준 중복 제거. 응답 JSON의 `addr`이 비어 있으면 UDP 발신자 IP로 보정.

- [ ] **Step 1: 실패 테스트 작성** — 루프백에서 응답기 기동(포트 0 아닌 임의 고정 대신 기본 포트+오프셋 충돌 방지를 위해 테스트는 포트를 직접 지정: 예 `17421`) 후 `discoverRooms({ port: 17421, timeoutMs: 1500 })`가 해당 방 1개를 찾는지, 응답기 2개(포트 17421/17422)면… — UDP 스캐너는 단일 포트만 스캔하므로 **응답기 여러 개가 같은 포트를 reuseAddr로 공유**하는 케이스로 2개 방 발견을 검증. 프로브가 아닌 쓰레기 패킷은 무시되는지 확인.

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인** — Run: `npm test -w packages/server`. (스캐너는 client 소스지만 테스트는 server 패키지에서 상대 경로 import — vitest workspace라 가능. client `package.json`이 아직 없는 파일을 export 하지 않도록 주의.)

- [ ] **Step 3: 수동 확인 (2대가 있으면)** — 같은 공유기에 물린 2대에서 응답기/스캐너 스크립트 실행해 실제 브로드캐스트 도달 확인. 1대뿐이면 루프백 테스트로 갈음하고 Task 16 수동 체크리스트에 포함.

- [ ] **Step 4: 전체 회귀** — Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: UDP 방 발견 (브로드캐스트 응답기 + 스캐너)"`

---

### Task 10: client — Connection과 설정 파일

**Files:**
- Create: `packages/client/src/net/connection.ts`, `packages/client/src/config.ts`
- Test: `packages/client/test/connection.test.ts`, `packages/client/test/config.test.ts`

**Interfaces:**
- Consumes: core `ClientMsg`/`ServerMsg`/`encodeMsg`/`NdjsonDecoder`; 테스트에서 Task 8 `startServer`
- Produces (UI가 사용):

```ts
export class Connection {
  static connect(host: string, port: number, nickname: string): Promise<Connection>;
  // TCP 접속 → join 송신 → 'joined' 수신까지 완료. error 메시지 수신 시 코드 포함 예외로 reject.
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  onClose(cb: () => void): void;    // 소켓 끊김 (호스트 이탈 감지)
  close(): void;
}
export function loadConfig(): { nickname?: string };          // ~/.soft-puzzle.json, 없거나 깨지면 {}
export function saveConfig(cfg: { nickname: string }): void;
export const CONFIG_PATH: string;  // path.join(os.homedir(), '.soft-puzzle.json')
```

- [ ] **Step 1: 실패 테스트 작성** — Connection: 실제 `startServer`(블랙잭 Room) 띄우고 ① connect 성공 시 joined 완료 ② 닉 중복 접속은 `dup` 코드로 reject ③ 서버 close 시 onClose 발화. Config: `CONFIG_PATH`를 환경변수 `SOFT_PUZZLE_CONFIG`로 오버라이드 가능하게 하여 임시 경로에서 저장/로드/깨진 JSON 복원 테스트.

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인** — Run: `npm test -w packages/client`.

- [ ] **Step 3: 전체 회귀** — Run: `npm test`.

- [ ] **Step 4: Commit** — `git commit -m "feat(client): 서버 Connection과 로컬 설정 저장"`

---

### Task 11: client — ASCII 아트 (카드·주사위·테마)

**Files:**
- Create: `packages/client/src/art/theme.ts`, `packages/client/src/art/cards.ts`, `packages/client/src/art/dice.ts`
- Test: `packages/client/test/art.test.ts`

**Interfaces:**
- Consumes: core `Card`, `suitOf`, `rankOf`, `isRed`
- Produces (게임 화면들이 사용):

```ts
// theme.ts
export interface Theme { unicode: boolean }
export function detectTheme(argv: string[], env: NodeJS.ProcessEnv): Theme;
// --ascii 플래그 → unicode:false.
// 아니면: win32 + Windows Terminal 아님(WT_SESSION 없음) + ConEmu 아님 → unicode:false. 그 외 true.

// cards.ts — 반환은 항상 문자열 5줄 배열(색은 UI 레이어에서 입힘)
export function renderCard(card: Card | 'back', theme: Theme): string[];   // 7칸×5줄
export function renderHand(cards: (Card | 'back')[], theme: Theme): string[]; // 겹침: 마지막만 전체, 나머지는 왼쪽 2칸
// dice.ts
export function renderDie(value: 1|2|3|4|5|6, held: boolean, theme: Theme): string[]; // 9칸×5줄, 홀드=이중선(═║)
export function renderDice(values: number[], held: boolean[], theme: Theme): string[]; // 가로 배열 + 아래 [잡음] 라벨
```

유니코드 테마: 테두리 `┌─┐│└┘`(홀드 `╔═╗║╚╝`), 무늬 `♠♥♦♣`, 뒷면 `▒`, 눈 `●`. ascii 테마: 테두리 `+-+|`(홀드 `#`), 무늬 `S H D C`, 뒷면 `#`, 눈 `o`. 스펙 §5의 레이아웃(카드: 1행 랭크 좌상단, 3행 중앙 무늬, 5행 랭크 우하단 / 주사위: 눈 배치)을 그대로 따른다. `10`은 두 글자라 `10♥`처럼 붙여 7칸 유지.

- [ ] **Step 1: 실패 테스트 작성**

```ts
it('KH 카드는 7칸×5줄', () => {
  const art = renderCard('KH', { unicode: true });
  expect(art).toHaveLength(5);
  for (const line of art) expect([...line]).toHaveLength(7); // 코드포인트 기준
  expect(art.join('\n')).toContain('♥');
});
it('겹침 렌더: 3장이면 폭 = 2+2+7', () => {
  const art = renderHand(['KH','7D','AS'], { unicode: true });
  expect([...art[0]]).toHaveLength(11);
});
it('주사위 스냅샷', () => {
  expect(renderDie(5, false, { unicode: true }).join('\n')).toMatchInlineSnapshot();
  expect(renderDie(6, true,  { unicode: true }).join('\n')).toMatchInlineSnapshot();
  expect(renderDie(3, false, { unicode: false }).join('\n')).toMatchInlineSnapshot();
});
it('ascii 테마에는 비ASCII 문자가 없다', () => {
  const all = [...renderCard('KH', { unicode: false }), ...renderDie(4, true, { unicode: false })].join('');
  expect(/^[\x20-\x7e]*$/.test(all)).toBe(true);
});
it('detectTheme: --ascii 플래그와 구형 콘솔 감지', () => {
  expect(detectTheme(['--ascii'], {}).unicode).toBe(false);
  expect(detectTheme([], { WT_SESSION: 'x' }).unicode).toBe(true);
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인** (인라인 스냅샷은 첫 실행에서 채워진 결과를 눈으로 검수 — 스펙 §5 도안과 대조)

- [ ] **Step 3: 눈 확인** — 데모 스크립트 `npx tsx -e`로 카드 여러 장·주사위 6면을 터미널에 찍어 직접 확인.

- [ ] **Step 4: Commit** — `git commit -m "feat(client): 카드/주사위 ASCII 아트와 테마 감지"`

---

### Task 12: client — TUI 프레임과 공통 화면

**Files:**
- Create: `packages/client/src/ui/App.tsx`, `packages/client/src/ui/screens/{Nickname,MainMenu,RoomList,Lobby,Result,Disconnected}.tsx`, `packages/client/src/ui/game/ActionBar.tsx`
- Modify: `packages/client/package.json` (deps: `ink@^5`, `react@^18`, `ink-text-input@^6`; devDeps: `ink-testing-library@^4`, `@types/react`)
- Test: `packages/client/test/ui-screens.test.tsx`

**Interfaces:**
- Consumes: Task 10 `Connection`/`loadConfig`/`saveConfig`, Task 9 `discoverRooms`, core `ServerMsg`, server `Room`/`startServer`/`startDiscovery`(호스트 모드)
- Produces:
  - `App({ initialTheme }: { initialTheme: Theme })` — 최상위 컴포넌트. 내부 화면 상태: `nickname → menu → (create: gameSelect) | (join: roomList) → lobby → game → result → disconnected`.
  - `ActionBar({ actions, labels }: { actions: string[]; labels: Record<string, string> })` — 하단 키 안내 바. `yourActions`에 있는 것만 표시. 예: `[b] 베팅  [h] 히트  [s] 스탠드`.
  - 게임 화면 플러그인 규약: `App`은 `state.room.game`에 따라 `{ blackjack: BlackjackView, onecard: OneCardView, yacht: YachtView }` 맵에서 화면을 고른다. 각 View의 props는 `{ view: GameView; you: string; send: (name: string, arg?: unknown) => void; theme: Theme }` (Task 13~15가 구현).

**화면 명세:**
- Nickname: 저장된 닉 있으면 스킵. 입력 후 `saveConfig`.
- MainMenu: `방 만들기 / 방 참가 / 종료`. 방 만들기 → 게임 선택(블랙잭/원카드/야추) → in-process로 `Room` 생성(`name: "<닉>의 방"`, host=나) + `startServer` + `startDiscovery` 기동 후 `127.0.0.1`로 self-connect → Lobby.
- RoomList: `discoverRooms` 결과 목록(방 이름·게임·인원). 새로고침 `r`, 없으면 "발견된 방이 없습니다" + `i` IP 직접 입력(`192.168.0.5:7420` 형식 파싱). 선택 시 connect → Lobby.
- Lobby: 참가자 목록(state.room.players, host 표시 ★), 방장이면 하단에 `[Enter] 시작`, 전원에게 안내 문구 `"방장이 나가면 방이 사라집니다"`. 호스트 화면엔 자기 `IP:포트` 표시(`os.networkInterfaces()`에서 IPv4 비내부 주소).
- Result: `state.result.ranking` 순위표. 방장은 `[r] 다시하기 / [q] 나가기`, 참가자는 대기 안내.
- Disconnected: `onClose` 발생 시 "방장의 연결이 끊겼습니다 (또는 서버와 연결이 끊어졌습니다)" + `[Enter] 메뉴로`.
- 공통 레이아웃: 상단 타이틀 바(방 이름·게임), 중앙 화면, 하단 이벤트 로그(최근 5개 `event` 텍스트) + ActionBar.

- [ ] **Step 1: 실패 테스트 작성** — `ink-testing-library`의 `render`로: ① Nickname 화면에서 입력·Enter 시 onSubmit 호출 ② Lobby가 players를 그린다(★ 호스트 표시 포함) ③ ActionBar는 `actions`에 있는 것만 표시 ④ Result가 랭킹 순서대로 그린다. (App 전체 통합은 Task 16 수동 체크리스트에서 검증 — 네트워크 목킹 비용 대비 가치 낮음. 화면 컴포넌트는 props 주입으로 순수하게 유지해 테스트한다.)

- [ ] **Step 2: 실패 확인 → 화면 구현 → 통과 확인** — Run: `npm test -w packages/client`.

- [ ] **Step 3: 손 검증** — 임시 실행 스크립트로 호스트 모드 기동 → 터미널 2개(두 번째는 `SOFT_PUZZLE_CONFIG` 다른 경로 + IP 직접 입력)로 로비까지 접속 확인.

- [ ] **Step 4: 전체 회귀** — Run: `npm test && npm run typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(client): Ink TUI 프레임과 공통 화면 (로비까지 동작)"`

---

### Task 13: client — 블랙잭 화면

**Files:**
- Create: `packages/client/src/ui/game/BlackjackView.tsx`
- Test: `packages/client/test/blackjack-view.test.tsx`

**Interfaces:**
- Consumes: Task 12의 View props 규약, Task 11 `renderHand`, Task 4 블랙잭 view 형태(`you: {hand, chips, bet}`, `others: [{nick, hand, chips, isTurn}]`, `dealer: {visible, hiddenCount}`, `phase`, `yourActions`)
- Produces: `BlackjackView` — App의 게임 화면 맵에 등록

**명세:** 딜러 패(숨김은 'back' 카드로) 상단, 각 플레이어 행(닉·패 아트·합계·칩·현재 턴 ◀ 표시), 내 행 강조. phase `betting`이면 베팅 입력(10 단위, `↑↓`로 조절 + Enter 또는 숫자 입력). 키: `h` hit, `s` stand, `d` double, Enter ready — **`yourActions`에 있을 때만** send. 라벨: `bet: "베팅"`, `hit: "히트"`, `stand: "스탠드"`, `double: "더블"`, `ready: "다음 판"`, `endGame: "게임 종료"`.

- [ ] **Step 1: 실패 테스트 작성** — 고정 view 객체를 props로 렌더: ① 내 패 두 장의 아트와 합계 `(17)` 표시 ② 딜러 숨김 카드가 뒷면으로 ③ `yourActions: ['hit','stand']`일 때 `h` 입력 → `send('hit')` 호출, `d` 입력 → 호출 안 됨.

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 3: 손 검증** — 2인 접속해 블랙잭 한 판 완주(베팅→히트/스탠드→정산→다음 판→종료→결과 화면).

- [ ] **Step 4: Commit** — `git commit -m "feat(client): 블랙잭 게임 화면"`

---

### Task 14: client — 야추 화면

**Files:**
- Create: `packages/client/src/ui/game/YachtView.tsx`
- Test: `packages/client/test/yacht-view.test.tsx`

**Interfaces:**
- Consumes: View props 규약, Task 11 `renderDice`, Task 5 야추 view 형태(`dice`, `held`, `rollsLeft`, `turnPlayer`, `sheets: Record<닉, Partial<Record<카테고리, number>>>`, `upperSum`, `yourActions`)
- Produces: `YachtView`

**명세:** 좌측 주사위 아트(현재 턴 플레이어 것) + 남은 굴림 수, 우측 전원 점수표(13행 × 인원 열, 빈 칸 `-`, 상단 소계/보너스/총점 행). 내 턴: `1`~`5` toggleHold, `r` reroll, 카테고리 선택 모드 `c` → `↑↓`+Enter로 score(이미 쓴 칸은 건너뜀). 카테고리 한글 라벨: `ones:"1(에이스)"` … `threeKind:"트리플"`, `fourKind:"포카드"`, `fullHouse:"풀하우스"`, `smallStraight:"S.스트레이트"`, `largeStraight:"L.스트레이트"`, `yacht:"야추!"`, `chance:"찬스"`.

- [ ] **Step 1: 실패 테스트 작성** — ① 주사위 5개 아트 + 홀드 이중선 표시 ② 점수표에 기록 점수·빈 칸 렌더 ③ `1` 입력 → `send('toggleHold', 0)`, rollsLeft 0이면 `r` 입력이 send를 호출하지 않음.

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 3: 손 검증** — 1인(혼자 연습) 13라운드 완주 + 2인 대전.

- [ ] **Step 4: Commit** — `git commit -m "feat(client): 야추 게임 화면"`

---

### Task 15: client — 원카드 화면

**Files:**
- Create: `packages/client/src/ui/game/OneCardView.tsx`
- Test: `packages/client/test/onecard-view.test.tsx`

**Interfaces:**
- Consumes: View props 규약, Task 11 `renderHand`/`renderCard`, Task 6 원카드 view 형태(`top`, `declaredSuit`, `attackStack`, `direction`, `you.hand`, `others: [{nick, handCount, isTurn}]`, `yourActions`)
- Produces: `OneCardView`

**명세:** 중앙에 top 카드(7 선언 시 `무늬: ♥` 뱃지, 공격 스택 `⚡+7` 표시), 상대들은 닉+뒷면 겹침(장수), 하단 내 패 겹침 아트 + `←→` 커서로 카드 선택(선택 카드는 한 줄 위로 올려 강조), Enter로 play. 7을 낼 때는 무늬 선택 팝업(`←→`+Enter). `d` draw. 방향 표시 `↻/↺`. 낼 수 없는 카드에 Enter 치면 아무 일도 없음(서버가 무시하는 것과 별개로, 클라에서도 시각적 흔들림 없이 무시).

- [ ] **Step 1: 실패 테스트 작성** — ① 내 패 겹침 렌더 + 커서 이동 ② top 카드와 공격 스택 표시 ③ 카드 선택 후 Enter → `send('play', { card: 'KH' })`, 7 선택 시 무늬 팝업 거쳐 `send('play', { card: '7S', declareSuit: 'H' })` ④ `d` → `send('draw')`.

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 3: 손 검증** — 3인 접속(터미널 3개)해 공격 카드·조커·7 선언 포함 한 판 완주.

- [ ] **Step 4: Commit** — `git commit -m "feat(client): 원카드 게임 화면"`

---

### Task 16: 엔트리·npm 패키지·수동 테스트 체크리스트

**Files:**
- Create: `packages/client/src/index.tsx` (bin 엔트리), `README.md`, `docs/manual-test-checklist.md`
- Modify: `packages/client/package.json` (bin/name/version/files, tsup 빌드), 루트 `package.json` (build 스크립트)

**Interfaces:**
- Consumes: 전체
- Produces: `npx soft-puzzle` / `npm i -g soft-puzzle`로 실행 가능한 패키지

- [ ] **Step 1: bin 엔트리 작성** — `#!/usr/bin/env node`, `detectTheme(process.argv, process.env)` 후 `render(<App initialTheme={...}/>)`. 종료 시 터미널 상태 복원(Ink 기본 + SIGINT 핸들러).

- [ ] **Step 2: 배포 빌드 구성** — client 패키지에 `tsup` 추가: `tsup src/index.tsx --format esm --bundle` 로 core/server를 포함한 단일 `dist/index.js` 생성(외부 deps는 ink/react만 dependencies로 유지). `package.json`: `"name": "soft-puzzle"`, `"bin": {"soft-puzzle": "dist/index.js"}`, `"files": ["dist"]`, `"engines": {"node": ">=22"}`. 검증: `npm run build && npm pack --dry-run -w packages/client` 후 다른 임시 디렉토리에서 `npm i -g <tarball>` → `soft-puzzle` 실행.

- [ ] **Step 3: README 작성** — 설치(`npm i -g soft-puzzle` 또는 git URL), 실행법, `--ascii` 옵션, 방화벽 안내(첫 실행 시 네트워크 허용 필요), 게임 3종 조작키 표.

- [ ] **Step 4: 수동 테스트 체크리스트 작성 및 1회 수행** — `docs/manual-test-checklist.md`: mac Terminal / Windows Terminal / 구형 PowerShell(conhost) 각각에서 — 실행·한글 표시·아트 렌더(`--ascii` 자동/수동)·방 발견·IP 폴백·게임 3종 각 1판·타임아웃 자동 처리·참가자 강제 종료·호스트 강제 종료 항목. 가능한 환경에서 수행하고 결과(환경·날짜·통과 여부)를 문서 하단에 기록.

- [ ] **Step 5: 최종 회귀 + Commit** — Run: `npm test && npm run typecheck && npm run build`. Expected: 전부 PASS. `git commit -m "feat: soft-puzzle bin 엔트리와 npm 패키지 구성"`

---

## Self-Review Notes

- 스펙 커버리지: §3 아키텍처(T1,4~8), §4 프로토콜·발견(T3,8,9), §5 화면·아트·ascii 폴백·닉네임 저장(T10~15), §6 게임 룰·타이머·딜러 멘트(T4~7), §7 이탈 처리(T7,8,12 Disconnected), §8 테스트 전략(각 태스크 TDD + T8 정보격리), §9 npm 배포(T16). 호스트 이탈 시 클라 안내와 로비 문구는 T12에 포함.
- 스펙 §3의 `GameEngine { join, ... }` 중 `join`은 로비(Room) 소관으로 정리하고 엔진은 `start(players)`로 명단을 받는다 — 스펙 의도(공통 인터페이스로만 진행) 내의 구체화.
- 조커가 바닥일 때 공격 해소 후 아무 카드나 낼 수 있다는 규칙은 스펙 §6 해석의 구체화로 canPlay 테스트에 고정했다.

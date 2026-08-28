import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { Room } from '../src/room.js';
import { startServer } from '../src/server.js';
import type { RunningServer } from '../src/server.js';
import { encodeMsg, NdjsonDecoder } from '@card-night/core';
import type { ClientMsg, ServerMsg, GameId } from '@card-night/core';

type StateMsg = Extract<ServerMsg, { type: 'state' }>;
type EventMsg = Extract<ServerMsg, { type: 'event' }>;
type JoinedMsg = Extract<ServerMsg, { type: 'joined' }>;
type ErrorMsg = Extract<ServerMsg, { type: 'error' }>;

function asState(msg: ServerMsg): StateMsg {
  if (msg.type !== 'state') throw new Error(`expected state, got ${msg.type}`);
  return msg;
}
function asEvent(msg: ServerMsg): EventMsg {
  if (msg.type !== 'event') throw new Error(`expected event, got ${msg.type}`);
  return msg;
}
function asJoined(msg: ServerMsg): JoinedMsg {
  if (msg.type !== 'joined') throw new Error(`expected joined, got ${msg.type}`);
  return msg;
}
function asError(msg: ServerMsg): ErrorMsg {
  if (msg.type !== 'error') throw new Error(`expected error, got ${msg.type}`);
  return msg;
}

/** 실소켓 + NdjsonDecoder로 서버와 대화하는 테스트용 클라이언트. */
class TestClient {
  readonly socket: net.Socket;
  /** 서버로부터 받은 원문 바이트를 그대로 이어붙인 것 — 패 유출 검사는 여기서 부분 문자열로 찾는다. */
  rawText = '';
  readonly closed: Promise<void>;

  private readonly decoder = new NdjsonDecoder();
  private readonly queue: ServerMsg[] = [];
  private readonly waiters: {
    type?: ServerMsg['type'];
    resolve: (m: ServerMsg) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  constructor(port: number) {
    this.socket = net.createConnection({ port, host: '127.0.0.1' });
    this.socket.on('data', (chunk: Buffer) => {
      this.rawText += chunk.toString('utf8');
      const parsed = this.decoder.push(chunk);
      for (const raw of parsed) this.onMessage(raw as ServerMsg);
    });
    this.closed = new Promise((resolve) => {
      this.socket.once('close', () => resolve());
    });
    // 테스트 중 소켓 에러(예: destroy 이후 write)로 프로세스가 죽지 않도록.
    this.socket.on('error', () => {});
  }

  private onMessage(msg: ServerMsg): void {
    const idx = this.waiters.findIndex((w) => !w.type || w.type === msg.type);
    if (idx !== -1) {
      const [w] = this.waiters.splice(idx, 1);
      clearTimeout(w.timer);
      w.resolve(msg);
      return;
    }
    this.queue.push(msg);
  }

  send(msg: ClientMsg): void {
    this.socket.write(encodeMsg(msg));
  }

  next(type?: ServerMsg['type'], timeoutMs = 3000): Promise<ServerMsg> {
    const idx = type ? this.queue.findIndex((m) => m.type === type) : this.queue.length > 0 ? 0 : -1;
    if (idx !== -1) return Promise.resolve(this.queue.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const wi = this.waiters.findIndex((w) => w.resolve === resolveWrapped);
        if (wi !== -1) this.waiters.splice(wi, 1);
        reject(new Error(`timeout waiting for ${type ?? 'any'} message`));
      }, timeoutMs);
      const resolveWrapped = (m: ServerMsg) => {
        clearTimeout(timer);
        resolve(m);
      };
      this.waiters.push({ type, resolve: resolveWrapped, timer });
    });
  }

  async waitForPhase(phase: 'lobby' | 'playing' | 'result'): Promise<StateMsg> {
    for (;;) {
      const msg = asState(await this.next('state'));
      if (msg.phase === phase) return msg;
    }
  }

  /** 엔진 자체의 서브 페이즈(view.phase, 예: 블랙잭의 'settle')가 될 때까지 기다린다. */
  async waitForViewPhase(viewPhase: string): Promise<StateMsg> {
    for (;;) {
      const msg = asState(await this.next('state'));
      if ((msg.view as unknown as { phase?: string } | undefined)?.phase === viewPhase) return msg;
    }
  }

  destroy(): void {
    this.socket.destroy();
  }
}

async function connectAndJoin(port: number, nickname: string): Promise<TestClient> {
  const client = new TestClient(port);
  await new Promise<void>((resolve, reject) => {
    client.socket.once('connect', () => resolve());
    client.socket.once('error', reject);
  });
  client.send({ type: 'join', nickname });
  const joined = asJoined(await client.next('joined'));
  expect(joined.you).toBe(nickname);
  return client;
}

function makeRoom(opts?: { game?: GameId; host?: string; name?: string }): Room {
  return new Room({
    name: opts?.name ?? '테스트 방',
    game: opts?.game ?? 'blackjack',
    host: opts?.host ?? '철수',
  });
}

/**
 * 블랙잭 베팅 → (자연 블랙잭이 아니면) stand까지 눌러 settle 단계로 보낸다.
 *
 * host/guest는 서로 다른 TCP 연결이라 두 연결 사이의 메시지 도착 순서는 보장되지 않는다 —
 * 베팅 두 건을 먼저 다 보내놓고 즉시 stand를 이어 보내면, 아직 상대 베팅이 서버에 도착하기
 * 전이라 "betting" 단계에서 stand가 조용히 무시될 수 있다(엔진 계약상 잘못된 액션은 예외
 * 없이 그냥 버려진다). 그래서 각 단계가 실제로 반영된 state를 확인한 뒤에만 다음 액션을
 * 보낸다 — host 쪽 스트림만 따라가도 room의 모든 브로드캐스트가 보이므로 그것으로 충분하다.
 */
async function betAndStand(host: TestClient, guest: TestClient, bets: [number, number]): Promise<void> {
  host.send({ type: 'action', name: 'bet', arg: bets[0] });
  guest.send({ type: 'action', name: 'bet', arg: bets[1] });

  let hostState = await waitPastBetting(host);
  while ((hostState.view as unknown as { phase: string }).phase === 'acting') {
    // 블랙잭 view의 "you"에는 isTurn이 없다(others[].isTurn만 있음) — yourActions가 비어있지
    // 않다는 것 자체가 "지금 내 턴"이라는 뜻이라 그걸로 판정한다.
    const isHostTurn = (hostState.view as unknown as { yourActions: string[] }).yourActions.length > 0;
    (isHostTurn ? host : guest).send({ type: 'action', name: 'stand' });
    hostState = asState(await host.next('state'));
  }
  await guest.waitForViewPhase('settle');
}

/** 베팅 단계를 벗어난(acting 또는 곧장 settle로 넘어간) 첫 state를 기다린다. */
async function waitPastBetting(client: TestClient): Promise<StateMsg> {
  for (;;) {
    const msg = asState(await client.next('state'));
    const viewPhase = (msg.view as unknown as { phase?: string } | undefined)?.phase;
    if (viewPhase && viewPhase !== 'betting') return msg;
  }
}

describe('startServer', () => {
  it('① 두 클라이언트가 접속해 로비→시작→블랙잭 베팅~정산까지 한 라운드를 완주한다', async () => {
    const room = makeRoom({ game: 'blackjack', host: '철수' });
    let server: RunningServer | undefined;
    const clients: TestClient[] = [];
    try {
      server = await startServer(room, 0);
      const host = await connectAndJoin(server.port, '철수');
      const guest = await connectAndJoin(server.port, '영희');
      clients.push(host, guest);

      // 두 번째 join으로 인한 lobby state를 흘려보내고, 방장이 시작.
      await host.waitForPhase('lobby');
      await guest.waitForPhase('lobby');
      host.send({ type: 'action', name: 'start' });

      const hostBetting = await host.waitForPhase('playing');
      const guestBetting = await guest.waitForPhase('playing');
      expect(hostBetting.room.players).toEqual(['철수', '영희']);
      expect(guestBetting.room.players).toEqual(['철수', '영희']);

      await betAndStand(host, guest, [10, 10]);

      // 정산(settle)까지는 Room의 phase가 여전히 'playing'이다 — 블랙잭 자체 서브 페이즈일
      // 뿐, 방장이 명시적으로 endGame을 눌러야 Room도 'result'로 넘어간다(room.test.ts와 동일).
      host.send({ type: 'action', name: 'endGame' });

      const hostFinal = await host.waitForPhase('result');
      const guestFinal = await guest.waitForPhase('result');
      expect(hostFinal.result).toBeDefined();
      expect(guestFinal.result).toBeDefined();
      expect(hostFinal.result!.ranking.map((r) => r.nickname).sort()).toEqual(['영희', '철수']);
    } finally {
      for (const c of clients) c.destroy();
      if (server) await server.close();
    }
  });

  it(
    '닉네임 앞뒤 공백이 trim되어 정규화되고, 소켓이 그 정규화된 키로 바인딩된다 ' +
      '(canonical = raw.nickname으로 되돌리면 이 테스트의 두 번째 절반에서 잡힌다)',
    async () => {
      const room = makeRoom({ host: '철수' });
      let server: RunningServer | undefined;
      const clients: TestClient[] = [];
      try {
        server = await startServer(room, 0);

        const host = new TestClient(server.port);
        clients.push(host);
        await new Promise<void>((resolve, reject) => {
          host.socket.once('connect', () => resolve());
          host.socket.once('error', reject);
        });
        host.send({ type: 'join', nickname: '  철수  ' });
        const joined = asJoined(await host.next('joined'));
        expect(joined.you).toBe('철수');

        // host 자신의 최초 lobby state — join() 처리 중 버퍼링됐다가 flush된 것.
        await host.waitForPhase('lobby');

        // 두 번째 클라이언트가 들어오면 room.onSend('철수', ...)가 호출된다 — Room은 항상
        // 정규화된 키('철수')로 부르므로, 소켓 맵이 raw 문자열('  철수  ')로 등록돼 있었다면
        // (naive echo 구현) 이 조회가 실패해 host는 이 브로드캐스트를 영영 받지 못하고
        // 아래 waitForPhase가 타임아웃난다. 이게 join.you 값만 확인해서는 못 잡는, 실제로
        // 중요한 절반이다.
        const guest = await connectAndJoin(server.port, '영희');
        clients.push(guest);

        const afterGuestJoin = await host.waitForPhase('lobby');
        expect(afterGuestJoin.room.players).toEqual(['철수', '영희']);
      } finally {
        for (const c of clients) c.destroy();
        if (server) await server.close();
      }
    },
  );

  it('② 원카드: 상대에게 보낸 어떤 메시지에도(이벤트 포함) 내 손패 카드가 등장하지 않는다', async () => {
    const room = makeRoom({ game: 'onecard', host: '철수' });
    let server: RunningServer | undefined;
    const clients: TestClient[] = [];
    try {
      server = await startServer(room, 0);
      const host = await connectAndJoin(server.port, '철수');
      const guest = await connectAndJoin(server.port, '영희');
      clients.push(host, guest);

      await host.waitForPhase('lobby');
      await guest.waitForPhase('lobby');
      host.send({ type: 'action', name: 'start' });

      const hostState = await host.waitForPhase('playing');
      const guestState = await guest.waitForPhase('playing');
      const hostHand = (hostState.view as unknown as { you: { hand: string[] } }).you.hand;
      const guestHand = (guestState.view as unknown as { you: { hand: string[] } }).you.hand;
      expect(hostHand.length).toBeGreaterThan(0);
      expect(guestHand.length).toBeGreaterThan(0);

      // isTurn을 기준으로 draw만 번갈아 진행 — 2인전에서 draw는 항상 턴을 넘기므로
      // 계속 교대된다. 이벤트/상태 메시지를 몇 차례 더 오가게 해서 유출 검사 범위를 넓힌다.
      let hostTurn = (hostState.view as unknown as { you: { isTurn: boolean } }).you.isTurn;
      expect(hostTurn).not.toBe(
        (guestState.view as unknown as { you: { isTurn: boolean } }).you.isTurn,
      );
      for (let i = 0; i < 4; i++) {
        const actor = hostTurn ? host : guest;
        const other = hostTurn ? guest : host;
        actor.send({ type: 'action', name: 'draw' });
        await actor.waitForPhase('playing');
        await other.waitForPhase('playing');
        hostTurn = !hostTurn;
      }

      for (const card of guestHand) {
        expect(host.rawText).not.toContain(card);
      }
      for (const card of hostHand) {
        expect(guest.rawText).not.toContain(card);
      }
    } finally {
      for (const c of clients) c.destroy();
      if (server) await server.close();
    }
  });

  it('③ join 없이 action을 먼저 보내면 error 후 소켓이 종료된다', async () => {
    const room = makeRoom();
    let server: RunningServer | undefined;
    const clients: TestClient[] = [];
    try {
      server = await startServer(room, 0);
      const client = new TestClient(server.port);
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        client.socket.once('connect', () => resolve());
        client.socket.once('error', reject);
      });

      client.send({ type: 'action', name: 'start' });
      const err = asError(await client.next('error'));
      expect(err.code).toBe('bad-msg');
      expect(err.message.length).toBeGreaterThan(0);

      await client.closed; // 서버가 소켓을 닫아야 한다
    } finally {
      for (const c of clients) c.destroy();
      if (server) await server.close();
    }
  });

  it('④ 소켓이 강제 종료되면 남은 클라이언트에게 이탈 event가 도착한다', async () => {
    // 3인으로 시작한다 — 2인이었다면 한 명이 이탈하는 순간 원카드는 "남은 1명이 최후
    // 생존자로 완주"로 즉시 게임을 끝내버려(order.length===1) phase가 곧장 'result'로
    // 넘어가므로, "이탈 후에도 게임이 계속 진행된다"는 이 테스트의 취지를 보여주지 못한다.
    const room = makeRoom({ game: 'onecard', host: '철수' });
    let server: RunningServer | undefined;
    const clients: TestClient[] = [];
    try {
      server = await startServer(room, 0);
      const host = await connectAndJoin(server.port, '철수');
      const guest1 = await connectAndJoin(server.port, '영희');
      const guest2 = await connectAndJoin(server.port, '민수');
      clients.push(host, guest1, guest2);

      await host.waitForPhase('lobby');
      await guest1.waitForPhase('lobby');
      await guest2.waitForPhase('lobby');
      host.send({ type: 'action', name: 'start' });
      await host.waitForPhase('playing');
      await guest1.waitForPhase('playing');
      await guest2.waitForPhase('playing');

      guest2.destroy();

      const departureEvent = asEvent(await host.next('event'));
      expect(departureEvent.text).toContain('민수님');
      expect(departureEvent.text).toContain('떠났습니다');

      const afterState = await host.waitForPhase('playing');
      expect(afterState.room.players).toEqual(['철수', '영희']);
    } finally {
      for (const c of clients) c.destroy();
      if (server) await server.close();
    }
  });

  it('⑤ 포트가 이미 사용 중이면 +1 포트로 기동한다', async () => {
    const occupied = net.createServer();
    let server: RunningServer | undefined;
    try {
      // startServer는 LAN 접속을 받아야 하므로 loopback이 아니라 와일드카드 주소에
      // 바인딩한다(아래 tryListen 참고). 같은 포트를 와일드카드로 선점해야 실제로 충돌해서
      // EADDRINUSE가 난다 — 127.0.0.1에만 걸어두면 와일드카드 바인딩과 겹치지 않아(이
      // 플랫폼에서 실측 확인됨) 재시도 경로 자체가 조용히 발동하지 않는다.
      const occupiedPort = await new Promise<number>((resolve) => {
        occupied.listen(0, () => {
          resolve((occupied.address() as net.AddressInfo).port);
        });
      });

      const room = makeRoom();
      server = await startServer(room, occupiedPort);
      expect(server.port).toBe(occupiedPort + 1);
    } finally {
      if (server) await server.close();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it('close()는 포트를 실제로 반환해 같은 포트로 즉시 재기동할 수 있다', async () => {
    const room1 = makeRoom();
    const server1 = await startServer(room1, 0);
    const port = server1.port;
    await server1.close();

    const room2 = makeRoom();
    const server2 = await startServer(room2, port);
    try {
      expect(server2.port).toBe(port);
    } finally {
      await server2.close();
    }
  });
});

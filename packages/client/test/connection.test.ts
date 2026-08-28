import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { Room, startServer } from '@card-night/server';
import type { RunningServer } from '@card-night/server';
import type { ServerMsg } from '@card-night/core';
import { Connection, JoinError } from '../src/net/connection.js';

describe('Connection', () => {
  const servers: RunningServer[] = [];
  const connections: Connection[] = [];

  afterEach(async () => {
    for (const c of connections.splice(0)) c.close();
    for (const s of servers.splice(0)) await s.close();
  });

  function makeRoom(host = '방장'): Room {
    return new Room({ name: '테스트 방', game: 'blackjack', host });
  }

  it('connect()는 join 송신 후 joined 수신까지 완료하고, 같은 배치로 온 초기 상태도 놓치지 않는다', async () => {
    const server = await startServer(makeRoom('플레이어1'));
    servers.push(server);

    const conn = await Connection.connect('127.0.0.1', server.port, '플레이어1');
    connections.push(conn);

    const messages: ServerMsg[] = [];
    const gotState = new Promise<void>((resolve) => {
      conn.onMessage((msg) => {
        messages.push(msg);
        if (msg.type === 'state') resolve();
      });
    });
    await gotState;

    const state = messages.find((m) => m.type === 'state');
    expect(state).toBeDefined();
    if (state?.type === 'state') {
      expect(state.room.players).toEqual(['플레이어1']);
    }
  });

  it('닉네임이 이미 사용 중이면 dup 코드로 reject한다', async () => {
    const server = await startServer(makeRoom('먼저옴'));
    servers.push(server);

    const first = await Connection.connect('127.0.0.1', server.port, '중복닉네임');
    connections.push(first);

    await expect(Connection.connect('127.0.0.1', server.port, '중복닉네임')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(JoinError);
      expect((err as JoinError).code).toBe('dup');
      expect((err as JoinError).message.length).toBeGreaterThan(0);
      return true;
    });
  });

  it('서버가 소켓을 종료하면(호스트 이탈) onClose가 정확히 한 번 발화한다', async () => {
    const server = await startServer(makeRoom('플레이어1'));
    servers.push(server);

    const conn = await Connection.connect('127.0.0.1', server.port, '플레이어1');
    connections.push(conn);

    let closeCount = 0;
    const closed = new Promise<void>((resolve) => {
      conn.onClose(() => {
        closeCount++;
        resolve();
      });
    });

    await server.close();
    servers.pop(); // 이미 닫혔으니 afterEach가 다시 닫지 않도록

    await closed;
    // 이벤트 루프에 한 바퀴 더 여유를 줘서 혹시 있을 두 번째 발화를 잡아낸다.
    await new Promise((r) => setTimeout(r, 20));
    expect(closeCount).toBe(1);
  });

  it('아무도 듣고 있지 않은 포트로 접속하면(잘못된 IP 시나리오) 빠르게 reject한다', async () => {
    // 실제로 아무도 안 듣는 포트를 확보한 뒤 바로 닫아서 accept 거부(ECONNREFUSED)를 유도한다.
    const probe = net.createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => resolve((probe.address() as AddressInfo).port));
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    await expect(Connection.connect('127.0.0.1', port, '아무개')).rejects.toBeInstanceOf(Error);
  });

  it('서버가 TCP는 받아주지만 응답이 없으면 타임아웃으로 reject한다(행 방지)', async () => {
    const silent = net.createServer((sock) => {
      // 아무 응답도 보내지 않는다 — join을 영원히 무시한다. resume()은 이 테스트 자체의 뒷정리를
      // 위한 것뿐이다: 이 소켓을 paused 상태로 두면 클라이언트가 보낸 join 바이트가 안 읽힌 채
      // 버퍼에 남아 있고, 그 상태에서 클라이언트가 destroy()로 끊어도 'end'가 못 나가 이 소켓의
      // close가 지연되어(테스트 뒤의 silent.close() 콜백이 영원히 안 옴) 스위트가 멈춘다 —
      // Connection 쪽의 동작과는 무관하다.
      sock.resume();
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
    const port = (silent.address() as AddressInfo).port;

    try {
      await expect(Connection.connect('127.0.0.1', port, '아무개', 150)).rejects.toBeInstanceOf(Error);
    } finally {
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });

  it('close()를 직접 호출하면 onClose가 발화하지 않는다(호스트 이탈로 오인되지 않아야 함)', async () => {
    const server = await startServer(makeRoom('플레이어1'));
    servers.push(server);

    const conn = await Connection.connect('127.0.0.1', server.port, '플레이어1');

    let called = false;
    conn.onClose(() => {
      called = true;
    });

    conn.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(called).toBe(false);
  });
});

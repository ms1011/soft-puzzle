import { describe, it, expect, afterEach } from 'vitest';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { startDiscovery } from '@soft-puzzle/server';
import type { RunningDiscovery } from '@soft-puzzle/server';
import { DISCOVERY_PROBE } from '@soft-puzzle/core';
import type { RoomInfo } from '@soft-puzzle/core';
import { discoverRooms } from '../src/net/discover.js';

function makeInfo(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return { room: '테스트 방', game: 'blackjack', players: '1/6', addr: '', ...overrides };
}

/** 아직 아무도 안 쓰는 포트 번호를 하나 얻어낸다(약간의 경합은 있으나 테스트에서는 충분). */
async function allocatePort(): Promise<number> {
  const probe = dgram.createSocket('udp4');
  return new Promise((resolve, reject) => {
    probe.on('error', reject);
    probe.bind(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * 응답기(startDiscovery)에 loopback으로 직접 유니캐스트 프로브 하나를 보내고, 응답 JSON을
 * 파싱해서 돌려준다. discoverRooms()를 거치지 않는다 — discoverRooms()는 255.255.255.255도
 * 함께 보내는데, 실제 네트워크 인터페이스가 살아있는 개발 머신에서는 그 브로드캐스트가 같은
 * 응답기에게 "다른 소스 주소로" 다시 한번 도달해(실측 확인: 아래 참고) addr가 서로 다른 중복
 * 항목이 생길 수 있다 — 이는 discoverRooms의 버그가 아니라 wildcard 바인딩된 응답기가 여러
 * 로컬 주소로 동시에 도달 가능하기 때문에 생기는, 환경에 따라 달라지는 현상이다. 응답기 자체의
 * addr 결정 로직만 결정적으로 검증하려면 이렇게 유니캐스트 하나로 직접 찔러야 한다.
 */
async function probeDirect(port: number, timeoutMs = 1200): Promise<RoomInfo> {
  const sock = dgram.createSocket('udp4');
  try {
    return await new Promise<RoomInfo>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for probe reply')), timeoutMs);
      sock.on('message', (msg) => {
        clearTimeout(timer);
        resolve(JSON.parse(msg.toString('utf8')) as RoomInfo);
      });
      sock.send(DISCOVERY_PROBE, port, '127.0.0.1');
    });
  } finally {
    sock.close();
  }
}

/**
 * discoverRooms()의 자체 로직(파싱/중복 제거/addr 보정/타임아웃)을 검증하기 위한, host를
 * '127.0.0.1'로 명시해서 바인딩하는 가짜 응답기. 명시적으로 특정 주소에 바인딩된 소켓은 목적지
 * 주소가 정확히 그 주소로 일치하는 패킷만 받으므로(와일드카드와 달리), discoverRooms()가 함께
 * 보내는 255.255.255.255 브로드캐스트가 이 소켓에 도달하지 않는다 — 오직 broadcastTargets()가
 * loopback 인터페이스용으로 직접 추가하는 127.0.0.1 유니캐스트 프로브 하나만 도달한다. 그래서
 * 이 픽스처를 쓰는 테스트는 실행 환경의 실제 네트워크 인터페이스 유무와 무관하게 결정적이다.
 */
async function bindLoopbackFakeResponder(
  reply: (probeSourcePort: number) => string,
): Promise<{ port: number; close(): void }> {
  const sock = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => sock.bind(0, '127.0.0.1', () => resolve()));
  sock.on('message', (msg, rinfo) => {
    if (msg.toString('utf8') !== DISCOVERY_PROBE) return;
    sock.send(reply(rinfo.port), rinfo.port, rinfo.address);
  });
  const port = (sock.address() as AddressInfo).port;
  return { port, close: () => sock.close() };
}

describe('startDiscovery (responder)', () => {
  const responders: RunningDiscovery[] = [];

  afterEach(() => {
    for (const r of responders.splice(0)) r.close();
  });

  it('loopback에서 온 프로브에는 항상 127.0.0.1로 응답한다(빈 addr을 스스로 채운다)', async () => {
    const responder = await startDiscovery(() => makeInfo({ room: '내 방' }), 0);
    responders.push(responder);

    const info = await probeDirect(responder.port);
    expect(info.room).toBe('내 방');
    expect(info.addr).toBe('127.0.0.1');
  });

  it('getInfo()가 이미 addr를 채워뒀다면 그 값을 그대로 돌려준다(덮어쓰지 않는다)', async () => {
    const responder = await startDiscovery(() => makeInfo({ room: '고정주소방', addr: '10.20.30.40' }), 0);
    responders.push(responder);

    const info = await probeDirect(responder.port);
    expect(info.addr).toBe('10.20.30.40');
  });

  it('프로브가 아닌 쓰레기 패킷(짧은 것/큰 것)은 조용히 무시하고, 이후 정상 프로브에는 여전히 응답한다', async () => {
    const responder = await startDiscovery(() => makeInfo({ room: '멀쩡한 방' }), 0);
    responders.push(responder);

    const junk = dgram.createSocket('udp4');
    try {
      await new Promise<void>((resolve, reject) => {
        junk.send('이건 프로브가 아님 { 잘못된 JSON', responder.port, '127.0.0.1', (err) =>
          err ? reject(err) : resolve(),
        );
      });
      await new Promise<void>((resolve, reject) => {
        // 프로브보다 훨씬 큰 쓰레기 — 길이만으로 먼저 걸러져야 한다(toString 비교조차 가지 않음).
        junk.send(Buffer.alloc(2000, 'x'), responder.port, '127.0.0.1', (err) =>
          err ? reject(err) : resolve(),
        );
      });
    } finally {
      junk.close();
    }

    const info = await probeDirect(responder.port);
    expect(info.room).toBe('멀쩡한 방');
  });

  it('close()는 멱등이며 포트를 실제로 반환해 같은 포트로 즉시 재기동할 수 있다', async () => {
    const responder = await startDiscovery(() => makeInfo(), 0);
    const port = responder.port;
    responder.close();
    expect(() => responder.close()).not.toThrow();

    const again = await startDiscovery(() => makeInfo({ room: '재기동' }), port);
    responders.push(again);
    expect(again.port).toBe(port);
  });

  it('선호 포트가 이미 사용 중이면(EADDRINUSE) +1 포트로 기동한다', async () => {
    const occupied = dgram.createSocket('udp4');
    const occupiedPort = await new Promise<number>((resolve) => {
      occupied.bind(0, () => resolve((occupied.address() as AddressInfo).port));
    });

    try {
      const responder = await startDiscovery(() => makeInfo({ room: '재시도방' }), occupiedPort);
      responders.push(responder);
      expect(responder.port).toBe(occupiedPort + 1);

      const info = await probeDirect(responder.port);
      expect(info.room).toBe('재시도방');
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it(
    'reuseAddr로 같은 포트를 공유하는 응답기 2개 — 각각 독립적으로 프로브에 응답한다 ' +
      '(유니캐스트 프로브 하나는 커널이 고른 한쪽에만 전달되므로, 먼저 응답한 쪽을 닫고 다시 ' +
      '찔러 두 번째 응답기도 살아서 응답함을 확인한다 — OS가 브로드캐스트 패킷을 reuseAddr로 ' +
      '묶인 두 소켓 모두에 팬아웃하는 것 자체는 실LAN 전용이라 여기서 재현하지 않는다, ' +
      'task-9-report.md 참고)',
    async () => {
      const port = await allocatePort();
      const a = await startDiscovery(() => makeInfo({ room: '방A' }), port);
      const b = await startDiscovery(() => makeInfo({ room: '방B' }), port);
      expect(a.port).toBe(port);
      expect(b.port).toBe(port);

      try {
        const first = await probeDirect(port);
        expect(['방A', '방B']).toContain(first.room);

        if (first.room === '방A') a.close();
        else b.close();
        const remaining = first.room === '방A' ? b : a;

        const second = await probeDirect(port);
        expect(second.room).toBe(first.room === '방A' ? '방B' : '방A');

        remaining.close();
      } finally {
        a.close();
        b.close();
      }
    },
  );
});

describe('discoverRooms (scanner)', () => {
  const fakes: { port: number; close(): void }[] = [];

  afterEach(() => {
    for (const f of fakes.splice(0)) f.close();
  });

  it('loopback 가짜 응답기 1개를 찾는다', async () => {
    const fake = await bindLoopbackFakeResponder(() =>
      JSON.stringify(makeInfo({ room: '가짜 방', addr: '127.0.0.1' })),
    );
    fakes.push(fake);

    const rooms = await discoverRooms({ port: fake.port, timeoutMs: 1200 });
    expect(rooms).toHaveLength(1);
    expect(rooms[0].room).toBe('가짜 방');
    expect(rooms[0].addr).toBe('127.0.0.1');
  });

  it('응답기가 없으면 reject하지 않고 빈 배열로 끝난다', async () => {
    const emptyPort = await allocatePort();

    const rooms = await discoverRooms({ port: emptyPort, timeoutMs: 800 });
    expect(rooms).toEqual([]);
  });

  it('응답 JSON의 addr가 비어 있으면 스캐너가 응답 패킷의 발신자 IP로 보정한다', async () => {
    const fake = await bindLoopbackFakeResponder(() =>
      JSON.stringify({ room: '주소미기입방', game: 'yacht', players: '2/6', addr: '' }),
    );
    fakes.push(fake);

    const rooms = await discoverRooms({ port: fake.port, timeoutMs: 1200 });
    expect(rooms).toHaveLength(1);
    expect(rooms[0].room).toBe('주소미기입방');
    expect(rooms[0].addr).toBe('127.0.0.1');
  });

  it('같은 addr로 여러 번 응답이 와도(프로브 3회) 결과는 addr 기준으로 중복 제거된다', async () => {
    let replyCount = 0;
    const fake = await bindLoopbackFakeResponder(() => {
      replyCount++;
      return JSON.stringify(makeInfo({ room: '반복응답방', addr: '127.0.0.1' }));
    });
    fakes.push(fake);

    const rooms = await discoverRooms({ port: fake.port, timeoutMs: 2600 });
    expect(rooms).toHaveLength(1);
    expect(rooms[0].room).toBe('반복응답방');
    // 프로브가 여러 번 도착했다는 것 자체는 확인해 "매번 딱 한 번만 응답이 왔을 뿐이라 우연히
    // 중복이 없었다"는 거짓양성을 배제한다.
    expect(replyCount).toBeGreaterThan(1);
  });

  it('프로브가 아닌 응답(JSON이 아니거나 형태가 다른 데이터)은 무시하고 방으로 집계하지 않는다', async () => {
    const sock = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => sock.bind(0, '127.0.0.1', () => resolve()));
    sock.on('message', (_msg, rinfo) => {
      sock.send('이건 RoomInfo가 아닌 아무 문자열', rinfo.port, rinfo.address);
    });
    const port = (sock.address() as AddressInfo).port;

    try {
      const rooms = await discoverRooms({ port, timeoutMs: 1200 });
      expect(rooms).toEqual([]);
    } finally {
      sock.close();
    }
  });
});

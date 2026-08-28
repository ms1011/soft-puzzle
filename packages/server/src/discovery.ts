import dgram from 'node:dgram';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { DISCOVERY_PROBE, DEFAULT_UDP_PORT } from '@soft-puzzle/core';
import type { RoomInfo } from '@soft-puzzle/core';

export interface RunningDiscovery {
  port: number;
  close(): void;
}

const MAX_PORT_RETRIES = 10;
/** 쓰레기 패킷에 시간을 낭비하지 않기 위한 상한 — 프로브 문자열보다 넉넉히 크면 충분하다. */
const MAX_PROBE_BYTES = 256;

/**
 * UDP 방 발견 응답기. WHO_IS_THERE 프로브를 받으면 getInfo()가 돌려주는 RoomInfo를 JSON으로
 * 되돌려준다. addr가 비어 있으면(Room은 자신이 어떤 주소로 도달 가능한지 모른다 — room.ts 참고)
 * 프로브가 들어온 소켓 정보로 채운다: 이 계층(응답기)만이 "이 프로브가 어느 인터페이스로
 * 들어왔는지"를 알 수 있는 위치이기 때문이다.
 *
 * IPv4(udp4)로만 바인딩한다 — LAN 발견은 IPv4 브로드캐스트 기반이라 굳이 이중 스택을 쓸 이유가
 * 없고, startServer의 TCP 와일드카드(::)와 달리 여기서는 애매함을 남기지 않는다.
 *
 * EADDRINUSE면 +1씩 최대 MAX_PORT_RETRIES(10)번 재시도한다(startServer와 동일한 패턴). 포트가
 * 65535를 넘어서기 직전에 멈춘다 — dgram.bind()는 65536처럼 유효 범위를 벗어난 포트를 던지지
 * 않고 조용히 wrap해버리는 것이 실측으로 확인되어(net.Server.listen의 동기 throw보다도 더
 * 위험하다), 그 값에 절대 도달하지 않도록 증가 전에 clamp한다.
 */
export function startDiscovery(
  getInfo: () => RoomInfo,
  preferredPort: number = DEFAULT_UDP_PORT,
): Promise<RunningDiscovery> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo): void => {
      // 네트워크에서 온 것은 아무것도 신뢰하지 않는다 — 크기부터 제한하고, 절대 JSON으로
      // 파싱하지 않으며, 정확히 프로브 문자열일 때만 반응한다. 그 외에는 조용히 무시한다.
      if (msg.length === 0 || msg.length > MAX_PROBE_BYTES) return;
      if (msg.toString('utf8') !== DISCOVERY_PROBE) return;

      const info = getInfo();
      const addr = info.addr.length > 0 ? info.addr : resolveRespondAddr(rinfo.address);
      const payload = JSON.stringify({ ...info, addr } satisfies RoomInfo);
      socket.send(payload, rinfo.port, rinfo.address, () => {
        // 응답 전송 실패(예: 상대가 이미 사라짐)는 무시한다 — 응답기가 죽을 이유가 아니다.
      });
    };

    let attempt = 0;
    let port = preferredPort;

    const onBindError = (err: NodeJS.ErrnoException): void => {
      if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_RETRIES && port < 65535) {
        attempt++;
        port++;
        socket.removeListener('error', onBindError);
        tryBind();
        return;
      }
      reject(err);
    };

    const tryBind = (): void => {
      socket.once('error', onBindError);
      socket.bind(port, () => {
        socket.removeListener('error', onBindError);
        socket.on('message', onMessage);
        // 응답기는 항상 발신자에게 유니캐스트로 답할 뿐 브로드캐스트를 보내지 않지만, 일부
        // 플랫폼에서 바인딩 전 setBroadcast 호출이 거부되는 것과 같은 제약이 있어 브리프의
        // 지시대로 바인딩 이후에 호출해둔다(응답기 동작에는 영향 없음 — 방어적으로만 켜둔다).
        try {
          socket.setBroadcast(true);
        } catch {
          // 실패해도 유니캐스트 응답 기능에는 영향이 없다.
        }
        const boundPort = (socket.address() as AddressInfo).port;
        let closed = false;
        resolve({
          port: boundPort,
          close(): void {
            if (closed) return;
            closed = true;
            socket.removeListener('message', onMessage);
            socket.close();
          },
        });
      });
    };

    tryBind();
  });
}

function isLoopback(addr: string): boolean {
  return addr === '127.0.0.1' || addr.startsWith('127.');
}

/**
 * getInfo()가 addr를 비워뒀을 때(Room은 스스로 도달 가능한 주소를 모른다) 프로브가 도착한
 * 소켓 정보로 채운다. 127.0.0.1은 프로브가 실제로 loopback에서 온 경우에만 돌려준다 — 그 외
 * 경우 127.0.0.1을 광고하면 같은 기기가 아닌 어떤 클라이언트에서도 연결할 수 없다(Task 8이
 * 겪었던 것과 같은 부류의 실패, "127.0.0.1로 방을 광고하면 아무도 못 들어온다").
 */
function resolveRespondAddr(remoteAddress: string): string {
  if (isLoopback(remoteAddress)) return '127.0.0.1';

  const ifaces = os.networkInterfaces();
  // 1순위: 프로브 발신자와 같은 서브넷에 있는 인터페이스 — 그 클라이언트가 실제로 도달
  // 가능한 주소일 가능성이 가장 높다.
  for (const addrs of Object.values(ifaces)) {
    for (const iface of addrs ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (sameSubnet(remoteAddress, iface.address, iface.netmask)) return iface.address;
    }
  }
  // 2순위: 서브넷이 안 맞아도(라우팅이 얽힌 네트워크 등) loopback이 아닌 주소가 loopback보다는
  // 낫다 — 최소한 같은 기기 밖에서도 시도해볼 여지가 있다.
  for (const addrs of Object.values(ifaces)) {
    for (const iface of addrs ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  // 3순위: 정말 아무 것도 없으면 빈 문자열로 둔다 — discoverRooms가 응답 패킷의 발신자 IP로
  // 보정하는 폴백을 갖고 있다(그건 항상 정확하다: 실제로 응답이 도달한 주소니까).
  return '';
}

function sameSubnet(a: string, b: string, netmask: string): boolean {
  const ai = ipToInt(a);
  const bi = ipToInt(b);
  const mi = ipToInt(netmask);
  if (ai === null || bi === null || mi === null) return false;
  return (ai & mi) === (bi & mi);
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

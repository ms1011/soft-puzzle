import dgram from 'node:dgram';
import os from 'node:os';
import { DISCOVERY_PROBE, DEFAULT_UDP_PORT } from '@soft-puzzle/core';
import type { RoomInfo, GameId } from '@soft-puzzle/core';

const GAME_IDS: readonly GameId[] = ['blackjack', 'onecard', 'yacht', 'mafia', 'davinci', 'liar', 'indianPoker', 'yut', 'lasVegas'];

export interface DiscoverOptions {
  /** 총 수집 시간(ms). 기본 3500 — 프로브 3회(1초 간격) 송신 뒤에도 응답이 돌아올 여유를 둔다. */
  timeoutMs?: number;
  /** 스캔할 UDP 포트. 기본 DEFAULT_UDP_PORT. */
  port?: number;
}

const DEFAULT_TIMEOUT_MS = 3500;
const PROBE_INTERVAL_MS = 1000;
const PROBE_COUNT = 3;
/** 응답 JSON이 이 크기를 넘으면 신뢰하지 않는다 — 방 정보(RoomInfo)는 원래 작다. */
const MAX_REPLY_BYTES = 4096;

/**
 * LAN에 있는 방을 찾는다. WHO_IS_THERE 프로브를 1초 간격으로 3회 브로드캐스트하고, timeoutMs가
 * 지나면 그때까지 모은 응답을 addr 기준으로 중복 제거해 돌려준다.
 *
 * 브로드캐스트가 막혀 있거나(컨테이너, 일부 방화벽, 브로드캐스트가 비활성화된 환경) 응답이
 * 하나도 없어도 절대 reject하지 않고 빈 배열로 resolve한다 — 호출부(UI)는 빈 배열을 수동 IP
 * 입력으로 폴백하라는 신호로 받아들인다.
 */
export function discoverRooms(opts: DiscoverOptions = {}): Promise<RoomInfo[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const port = opts.port ?? DEFAULT_UDP_PORT;

  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const found = new Map<string, RoomInfo>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let settled = false;
    let bound = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      socket.removeAllListeners();
      try {
        socket.close();
      } catch {
        // 이미 닫혀 있으면 무시 — 어떤 상황에서도 소켓이 이벤트 루프를 붙잡고 있지 않게 한다.
      }
      resolve([...found.values()]);
    };

    socket.on('message', (msg, rinfo) => {
      if (msg.length === 0 || msg.length > MAX_REPLY_BYTES) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg.toString('utf8'));
      } catch {
        return; // 프로브 응답이 아닌 쓰레기
      }
      if (!isRoomInfoLike(parsed)) return;
      // 응답기가 addr를 못 채웠다면(극단적으로 알려줄 인터페이스가 전혀 없는 경우) 이 응답이
      // 실제로 도착한 발신자 IP로 보정한다 — 이건 항상 정확하다(그 IP에서 실제로 패킷이 왔다).
      const addr = parsed.addr.length > 0 ? parsed.addr : rinfo.address;
      found.set(addr, { ...parsed, addr });
    });

    // 바인딩/전송 단계의 에러(예: 브로드캐스트 자체가 막힌 플랫폼)도 스캔을 중단시키지 않는다.
    socket.on('error', () => {
      if (!bound) finish(); // 바인딩조차 안 됐다면 더 기다릴 이유가 없다 — 즉시 빈 목록으로.
    });

    const sendProbes = (): void => {
      for (const target of broadcastTargets()) {
        try {
          socket.send(DISCOVERY_PROBE, port, target, () => {
            // 개별 전송 실패는 스캔 전체를 막지 않는다 — 다른 대상으로는 계속 시도한다.
          });
        } catch {
          // send()가 동기적으로 던지는 경우(잘못된 주소 등)도 마찬가지로 무시.
        }
      }
    };

    socket.bind(() => {
      bound = true;
      try {
        socket.setBroadcast(true);
      } catch {
        // 브로드캐스트가 막힌 플랫폼이어도 loopback 대상 유니캐스트 전송(broadcastTargets가
        // loopback 인터페이스를 특별 취급하는 부분)은 여전히 시도한다.
      }
      for (let i = 0; i < PROBE_COUNT; i++) {
        timers.push(setTimeout(sendProbes, i * PROBE_INTERVAL_MS));
      }
      timers.push(setTimeout(finish, timeoutMs));
    });
  });
}

/** 응답 JSON을 신뢰하지 않는다 — 모양과 game 값(GameId 리터럴)까지 검증한 뒤에만 RoomInfo로 받아들인다. */
function isRoomInfoLike(v: unknown): v is RoomInfo {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.room === 'string' &&
    typeof o.game === 'string' &&
    (GAME_IDS as readonly string[]).includes(o.game) &&
    typeof o.players === 'string' &&
    typeof o.addr === 'string'
  );
}

/**
 * 프로브를 보낼 대상 주소 목록: 255.255.255.255(제한 브로드캐스트) + 각 non-loopback IPv4
 * 인터페이스의 서브넷 브로드캐스트 주소(주소 | ~넷마스크).
 *
 * loopback(127.0.0.1)은 서브넷 브로드캐스트 주소(127.255.255.255)로 보내도 전달되지 않는다 —
 * lo 인터페이스는 IFF_BROADCAST를 지원하지 않기 때문(실측 확인: 같은 기기에서 udp4 소켓 두 개로
 * 재현했을 때 127.255.255.255 전송은 어느 쪽에도 도달하지 않았다). 그래서 loopback
 * 인터페이스는 자기 자신의 주소로 직접(유니캐스트) 보내 — 같은 기기에서 실행 중인 응답기(개발
 * 중 로컬 테스트 포함)도 여전히 찾을 수 있게 한다.
 */
function broadcastTargets(): string[] {
  const targets = new Set<string>(['255.255.255.255']);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const iface of addrs ?? []) {
      if (iface.family !== 'IPv4') continue;
      if (iface.internal) {
        targets.add(iface.address);
        continue;
      }
      const bcast = computeBroadcast(iface.address, iface.netmask);
      if (bcast) targets.add(bcast);
    }
  }
  return [...targets];
}

function computeBroadcast(address: string, netmask: string): string | null {
  const a = ipToInt(address);
  const m = ipToInt(netmask);
  if (a === null || m === null) return null;
  return intToIp((a | (~m >>> 0)) >>> 0);
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

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

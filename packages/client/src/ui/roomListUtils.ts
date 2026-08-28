import type { RoomInfo } from '@card-night/core';

/** loopback(127.0.0.1)로 취급하는 주소. discoverRooms가 돌려주는 addr는 IPv4 문자열이다. */
function isLoopbackAddr(addr: string): boolean {
  return addr === '127.0.0.1' || addr.startsWith('127.');
}

/**
 * discoverRooms() 결과를 UI에 보여주기 전에 "같은 방"을 하나로 합친다.
 *
 * discoverRooms는 loopback과 서브넷 브로드캐스트를 모두 찌르고 addr(응답 주소) 기준으로만
 * 중복을 없앤다 — 그런데 RoomInfo에는 방을 구분할 고유 id가 없다. 그래서 호스트가 자기 컴퓨터
 * 에서 서버와 클라이언트를 함께 돌리는(이 게임의 정상 시나리오) 경우, 같은 방이
 * 127.0.0.1(loopback 프로브 응답)과 LAN IP(서브넷 브로드캐스트 응답) 두 항목으로 잡혀 사용자
 * 눈에는 방이 두 개인 것처럼 보인다.
 *
 * RoomInfo가 실제로 방을 식별하는 필드는 room 이름 + game + players(인원 문자열, 예: "1/6")뿐이라
 * 이 세 값을 키로 묶는다. 같은 키에 여러 항목이 모이면 loopback이 아닌 주소를 우선한다 — 다른
 * 사람은 127.0.0.1로 접속할 수 없으므로, 화면에 보여줄(그리고 연결에 쓸) 주소는 실제로 남들이
 * 쓸 수 있는 LAN 주소여야 한다.
 */
export function dedupeRooms(rooms: RoomInfo[]): RoomInfo[] {
  const byKey = new Map<string, RoomInfo>();
  for (const room of rooms) {
    const key = `${room.room} ${room.game} ${room.players}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, room);
      continue;
    }
    if (isLoopbackAddr(existing.addr) && !isLoopbackAddr(room.addr)) {
      byKey.set(key, room);
    }
  }
  return [...byKey.values()];
}

/**
 * 사용자가 입력한 "192.168.0.5:7420" 형식을 host/port로 나눈다. 형식이 잘못됐거나 포트가
 * 유효 범위(1~65535)를 벗어나면 null.
 */
export function parseHostPort(input: string): { host: string; port: number } | null {
  const trimmed = input.trim();
  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  const host = trimmed.slice(0, idx);
  const portStr = trimmed.slice(idx + 1);
  if (!/^\d+$/.test(portStr)) return null;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

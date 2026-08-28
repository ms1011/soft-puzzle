import { DEFAULT_TCP_PORT } from '@soft-puzzle/core';
import type { RoomInfo } from '@soft-puzzle/core';

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

/**
 * discoverRooms()가 돌려준 RoomInfo.addr를 실제 접속에 쓸 host/port로 바꾼다(중요사항 1).
 *
 * 방장 쪽(App.tsx)이 이제 항상 "ip:port" 형태로 addr를 광고하므로 보통은 parseHostPort가
 * 곧바로 성공한다. 그래도 addr에 포트가 없는(콜론 자체가 없는) 옛 응답기 — 또는 앞으로 나올
 * 확장 응답기 — 와의 호환을 위해, 포트를 못 뽑아낸 경우에만 DEFAULT_TCP_PORT로 폴백한다.
 * "포트가 없다"와 "형식이 통째로 이상하다"를 구분하지 않는 이유: addr는 서버가 만든 신뢰
 * 가능한 필드(사용자 자유 입력이 아님)라, 콜론이 없으면 십중팔구 그냥 옛 프로토콜의 IP뿐인
 * addr다.
 */
export function resolveRoomTarget(room: RoomInfo): { host: string; port: number } {
  const parsed = parseHostPort(room.addr);
  if (parsed) return parsed;
  return { host: room.addr, port: DEFAULT_TCP_PORT };
}

import { describe, it, expect } from 'vitest';
import { dedupeRooms, parseHostPort } from '../src/ui/roomListUtils.js';
import type { RoomInfo } from '@card-night/core';

function room(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return { room: '테스트 방', game: 'blackjack', players: '1/6', addr: '127.0.0.1', ...overrides };
}

describe('dedupeRooms (결정 5)', () => {
  it('같은 방 이름·게임·인원이 loopback과 LAN 주소로 두 번 잡히면 하나로 합친다', () => {
    const rooms = [
      room({ addr: '127.0.0.1' }),
      room({ addr: '192.168.0.5' }),
    ];
    const result = dedupeRooms(rooms);
    expect(result).toHaveLength(1);
    // 다른 사람은 127.0.0.1로 못 들어오므로 LAN 주소를 남겨야 한다.
    expect(result[0]!.addr).toBe('192.168.0.5');
  });

  it('LAN 주소가 먼저 들어와도(순서 무관) loopback을 밀어낸다', () => {
    const rooms = [room({ addr: '192.168.0.5' }), room({ addr: '127.0.0.1' })];
    const result = dedupeRooms(rooms);
    expect(result).toHaveLength(1);
    expect(result[0]!.addr).toBe('192.168.0.5');
  });

  it('진짜로 다른 방(이름이 다름)은 합치지 않는다', () => {
    const rooms = [room({ room: '방A', addr: '127.0.0.1' }), room({ room: '방B', addr: '127.0.0.1' })];
    expect(dedupeRooms(rooms)).toHaveLength(2);
  });

  it('인원 수가 다르면(같은 방 이름이라도) 다른 방으로 취급한다', () => {
    const rooms = [room({ players: '1/6', addr: '127.0.0.1' }), room({ players: '2/6', addr: '192.168.0.5' })];
    expect(dedupeRooms(rooms)).toHaveLength(2);
  });

  it('빈 배열은 빈 배열을 돌려준다', () => {
    expect(dedupeRooms([])).toEqual([]);
  });
});

describe('parseHostPort', () => {
  it('"192.168.0.5:7420" 형식을 host/port로 나눈다', () => {
    expect(parseHostPort('192.168.0.5:7420')).toEqual({ host: '192.168.0.5', port: 7420 });
  });

  it('콜론이 없으면 null', () => {
    expect(parseHostPort('192.168.0.5')).toBeNull();
  });

  it('포트가 숫자가 아니면 null', () => {
    expect(parseHostPort('192.168.0.5:abc')).toBeNull();
  });

  it('포트가 범위를 벗어나면 null', () => {
    expect(parseHostPort('192.168.0.5:70000')).toBeNull();
    expect(parseHostPort('192.168.0.5:0')).toBeNull();
  });

  it('앞뒤 공백은 무시한다', () => {
    expect(parseHostPort('  192.168.0.5:7420  ')).toEqual({ host: '192.168.0.5', port: 7420 });
  });
});

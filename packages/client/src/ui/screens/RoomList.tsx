import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { RoomInfo } from '@soft-puzzle/core';
import { GAME_LABELS } from '../gameLabels.js';
import { parseHostPort } from '../roomListUtils.js';

export interface RoomListProps {
  /** App이 이미 dedupeRooms()로 중복을 제거해 넘긴 목록 (결정 5 — 호스트 자신의 방이 두 번
   * 보이지 않게 하는 처리는 App 쪽 책임이고, 이 화면은 받은 목록을 그대로 그린다). */
  rooms: RoomInfo[];
  scanning: boolean;
  /** App이 connectAndWire를 기다리는 중이면 true. 이 화면은 그 사이 모든 입력을 무시하고
   * "연결 중..." 안내만 보여준다 — 그 짧은(최대 5초) 창 동안 두 번째 Enter가 두 번째 연결을
   * 열어버리면, 서버가 같은 닉네임을 'dup'으로 거절하며 방금 성공한 연결까지 고아로 만든다. */
  connecting: boolean;
  error?: string;
  onRefresh: () => void;
  onSelect: (room: RoomInfo) => void;
  onManualConnect: (host: string, port: number) => void;
  /** Esc/q — 방을 찾지 못했거나 마음이 바뀐 사용자가 메인 메뉴로 돌아간다. */
  onCancel: () => void;
}

/**
 * 방 목록 화면. 방향키로 목록을 고르고 Enter로 입장, r로 새로고침, i로 IP 직접 입력 모드로
 * 전환한다("192.168.0.5:7420" 형식). 목록이 비어 있으면 안내 문구를 보여준다. Esc/q로 메인
 * 메뉴로 돌아간다(수동 입력 모드에서는 Esc가 먼저 그 모드만 취소한다).
 */
export function RoomList({
  rooms,
  scanning,
  connecting,
  error,
  onRefresh,
  onSelect,
  onManualConnect,
  onCancel,
}: RoomListProps): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState<string | undefined>(undefined);

  // rooms가 새로고침으로 줄어들면(예: 두 방 중 하나가 사라짐) selected가 이전 목록 길이 기준
  // 인덱스에 그대로 남아 범위 밖을 가리킬 수 있다 — 그 상태에서 Enter를 누르면
  // rooms[selected]가 undefined가 되어 onSelect(undefined)가 useInput 핸들러 안에서 그대로
  // 터진다(치명적 결함 — OneCardView의 커서 클램프와 같은 패턴으로 막는다).
  useEffect(() => {
    setSelected((i) => Math.min(i, Math.max(0, rooms.length - 1)));
  }, [rooms.length]);

  useInput((input, key) => {
    if (connecting) return; // 연결 시도 중에는 어떤 입력도 받지 않는다 — 중요사항 3.

    if (manualMode) {
      if (key.escape) {
        setManualMode(false);
        setManualError(undefined);
      }
      return;
    }

    if (input === 'r') {
      onRefresh();
      return;
    }
    if (input === 'i') {
      setManualMode(true);
      setManualValue('');
      setManualError(undefined);
      return;
    }
    if (input === 'q' || key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelected((i) => (rooms.length === 0 ? 0 : (i - 1 + rooms.length) % rooms.length));
      return;
    }
    if (key.downArrow) {
      setSelected((i) => (rooms.length === 0 ? 0 : (i + 1) % rooms.length));
      return;
    }
    if (key.return && rooms.length > 0) {
      // 위 effect가 대부분의 경우를 미리 막아주지만, 같은 렌더 사이클 안에서 rooms가 줄고
      // 그 즉시 Enter가 들어오는 것처럼 effect가 아직 못 따라잡은 경로가 미래에 생기더라도
      // undefined를 onSelect로 넘기지 않도록 여기서도 한 번 더 방어한다.
      const room = rooms[selected];
      if (room) onSelect(room);
    }
  });

  const handleManualSubmit = (raw: string): void => {
    const parsed = parseHostPort(raw);
    if (parsed === null) {
      setManualError('형식이 올바르지 않습니다. 예: 192.168.0.5:7420');
      return;
    }
    onManualConnect(parsed.host, parsed.port);
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>방 목록 ({rooms.length}개)</Text>
      {connecting && <Text dimColor>연결 중...</Text>}
      {!connecting && scanning && <Text dimColor>검색 중...</Text>}
      {!connecting && !scanning && rooms.length === 0 && !manualMode && (
        <Text>발견된 방이 없습니다</Text>
      )}

      {!manualMode &&
        rooms.map((room, i) => (
          <Text key={`${room.addr}-${room.room}`} inverse={i === selected}>
            {i === selected ? '> ' : '  '}
            {room.room} [{GAME_LABELS[room.game]}] {room.players} - {room.addr}
          </Text>
        ))}

      {manualMode && (
        <Box flexDirection="column">
          <Text>IP:포트를 입력하세요 (예: 192.168.0.5:7420, Esc로 취소):</Text>
          <Box>
            <Text>{'> '}</Text>
            <TextInput value={manualValue} onChange={setManualValue} onSubmit={handleManualSubmit} />
          </Box>
          {manualError !== undefined && <Text color="red">{manualError}</Text>}
        </Box>
      )}

      {error !== undefined && <Text color="red">{error}</Text>}

      {!manualMode && (
        <Text dimColor>[r] 새로고침 [i] IP 직접 입력 [Enter] 입장 [q] 메뉴로</Text>
      )}
    </Box>
  );
}

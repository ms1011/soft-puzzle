import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import os from 'node:os';
import { DEFAULT_TCP_PORT } from '@card-night/core';
import type { GameId, ServerMsg, RoomInfo } from '@card-night/core';
import { Room, startServer, startDiscovery } from '@card-night/server';
import type { RunningServer, RunningDiscovery } from '@card-night/server';
import { Connection, JoinError } from '../net/connection.js';
import { discoverRooms } from '../net/discover.js';
import { loadConfig, saveConfig } from '../config.js';
import type { Theme } from '../art/theme.js';
import { GAME_LABELS, ACTION_LABELS } from './gameLabels.js';
import { dedupeRooms } from './roomListUtils.js';
import { Nickname } from './screens/Nickname.js';
import { MainMenu } from './screens/MainMenu.js';
import { RoomList } from './screens/RoomList.js';
import { Lobby } from './screens/Lobby.js';
import { Result } from './screens/Result.js';
import { Disconnected } from './screens/Disconnected.js';
import { ActionBar } from './game/ActionBar.js';
import { BlackjackView } from './game/BlackjackView.js';
import { OneCardView } from './game/OneCardView.js';
import { YachtView } from './game/YachtView.js';
import type { GameViewProps } from './game/types.js';

export interface AppProps {
  initialTheme: Theme;
}

type Screen = 'nickname' | 'menu' | 'roomList' | 'lobby' | 'game' | 'result' | 'disconnected';
type RoomStateMsg = Extract<ServerMsg, { type: 'state' }>;

/** 화면 플러그인 규약(브리프 §Interfaces) — Task 13~15가 각자의 View로 이 자리를 채운다. */
const GAME_VIEWS: Record<GameId, (props: GameViewProps) => React.JSX.Element> = {
  blackjack: BlackjackView,
  onecard: OneCardView,
  yacht: YachtView,
};

/**
 * 저장된 설정 파일의 nickname을 NFC 정규화·trim해서 돌려준다. 결정 3은 "입력 시점"에
 * Nickname.tsx에서 적용되지만, 그건 사용자가 직접 타이핑해 저장한 값에만 해당한다 — 이전
 * 빌드가 저장했거나 사람이 손으로 고친 설정 파일은 NFD나 앞뒤 공백을 그대로 담고 있을 수
 * 있다. 그 값이 정규화 없이 new Room({ host })로 들어가면, 서버가 trim한 canonical
 * players/host 문자열과 영영 달라져 자기 방에서 자신을 호스트로 인식하지 못하는(★도, [Enter]
 * 시작도 못 보는) 회복 불가능한 상태가 된다 — 그래서 여기서도 같은 정규화를 한 번 더 건다.
 */
function loadSavedNickname(): string {
  return loadConfig().nickname?.normalize('NFC').trim() ?? '';
}

/** os.networkInterfaces()에서 첫 비내부(non-internal) IPv4 주소. 127.0.0.1은 호스트 본인만
 * 쓸 수 있어 "남에게 불러줄 주소"로는 의미가 없다 — 그래서 걸러낸다. */
function firstNonInternalIPv4(): string | undefined {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const iface of addrs ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return undefined;
}

function GameScreen({
  view,
  you,
  send,
  theme,
  game,
}: GameViewProps & { game: GameId }): React.JSX.Element {
  const View = GAME_VIEWS[game];
  return (
    <Box flexDirection="column">
      <View view={view} you={you} send={send} theme={theme} />
      {/* 요구사항 4: 행동 바는 항상 지금 view.yourActions에서만 나온다 — 하드코딩된 목록이
       * 아니다. ACTION_LABELS는 세 엔진이 실제로 쓰는 액션 이름을 미리 채운 한국어 사전이고,
       * 거기 없는 액션(향후 새 액션 등)은 ActionBar 자체 계약대로 이름 그대로 폴백한다. */}
      <ActionBar actions={view.yourActions} labels={ACTION_LABELS} />
    </Box>
  );
}

/**
 * TUI 최상위 컴포넌트. 화면 상태 기계와 네트워크/파일시스템 부수효과를 전부 여기서 쥐고, 화면
 * 컴포넌트에는 순수하게 props만 내려보낸다(요구사항 1 — 화면은 Connection/소켓/fs를 절대
 * 직접 만지지 않는다).
 */
export function App({ initialTheme }: AppProps): React.JSX.Element {
  const { exit } = useApp();

  const [screen, setScreen] = useState<Screen>(() => (loadSavedNickname() ? 'menu' : 'nickname'));
  const [nickname, setNickname] = useState<string>(loadSavedNickname);
  // 결정 2: "나"는 오직 서버가 정규화해 돌려준 이 값으로만 식별한다 — 아래 connectAndWire에서
  // conn.nickname을 대입하는 곳 외에는 절대 다른 값을 쓰지 않는다.
  const [you, setYou] = useState<string>('');
  const [roomState, setRoomState] = useState<RoomStateMsg | null>(null);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [menuError, setMenuError] = useState<string | undefined>(undefined);
  const [roomListError, setRoomListError] = useState<string | undefined>(undefined);
  // 'dup' 거절(중복 또는 형식이 잘못된 닉네임)로 방 참가가 막혔을 때, 방 목록이 아니라
  // Nickname 화면으로 돌려보내며 채우는 메시지 — 사용자가 닉네임을 바꿀 방법이 이것뿐이다.
  const [nicknameError, setNicknameError] = useState<string | undefined>(undefined);
  const [hostAddr, setHostAddr] = useState<string | undefined>(undefined);
  const [disconnectMessage, setDisconnectMessage] = useState('');

  const connectionRef = useRef<Connection | null>(null);
  const serverRef = useRef<RunningServer | null>(null);
  const discoveryRef = useRef<RunningDiscovery | null>(null);

  const cleanupResources = useCallback((): void => {
    connectionRef.current?.close();
    connectionRef.current = null;
    discoveryRef.current?.close();
    discoveryRef.current = null;
    if (serverRef.current) {
      void serverRef.current.close();
      serverRef.current = null;
    }
  }, []);

  // 요구사항 3(정리된 종료): 프로세스가 어떤 경로로 끝나든(Ctrl+C 포함) 리스닝 소켓을 남기지
  // 않는다. Ink는 Ctrl+C를 자체적으로 처리해 앱을 unmount하고 raw mode를 복원하지만(터미널
  // 복원은 Ink 몫), 우리가 띄운 Room의 TCP 서버·UDP 디스커버리 응답기는 전혀 모른다 — 정리하지
  // 않으면 그 listen 소켓이 이벤트 루프를 계속 붙잡아, 화면은 사라졌는데 프로세스만 안 끝나는
  // "행 걸림"으로 보인다. 이 effect의 cleanup은 정확히 그 unmount 시점에 실행된다.
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  const handleServerMsg = useCallback((msg: ServerMsg): void => {
    if (msg.type === 'state') {
      setRoomState(msg);
      setScreen(msg.phase === 'playing' ? 'game' : msg.phase);
    } else if (msg.type === 'event') {
      setEventLog((prev) => [...prev, msg.text].slice(-5));
    }
    // 'joined'/'error'는 핸드셰이크 전용 메시지라 Connection이 onMessage로는 절대 넘기지
    // 않는다(connection.ts 참고) — 여기서 다룰 필요가 없다.
  }, []);

  const connectAndWire = useCallback(
    async (host: string, port: number, nick: string): Promise<void> => {
      const conn = await Connection.connect(host, port, nick);
      connectionRef.current = conn;
      setYou(conn.nickname);
      conn.onMessage(handleServerMsg);
      conn.onClose(() => {
        // 결정 6: onClose는 언제나 "세션이 정상적으로 끝났다"는 뜻이다. 우리가 서버를
        // 띄운 쪽(호스트)인지 아닌지로 문구만 달리한다.
        setDisconnectMessage(
          serverRef.current !== null ? '서버와 연결이 끊어졌습니다.' : '방장의 연결이 끊겼습니다.',
        );
        setRoomState(null);
        setEventLog([]);
        setScreen('disconnected');
      });
    },
    [handleServerMsg],
  );

  const handleNicknameSubmit = useCallback((normalized: string): void => {
    // Nickname 화면이 이미 NFC 정규화·trim을 마친 값만 onSubmit으로 넘긴다 — 여기서는
    // 저장·상태 반영만 한다.
    saveConfig({ nickname: normalized });
    setNickname(normalized);
    setNicknameError(undefined);
    setScreen('menu');
  }, []);

  const refreshRooms = useCallback((): void => {
    setScanning(true);
    setRoomListError(undefined);
    discoverRooms()
      .then((found) => {
        // 결정 5: room 이름·game·인원(players)이 같은 항목은 한 방으로 합친다 — loopback과
        // LAN IP로 두 번 잡히는 자기 자신의 방을 사용자에게 두 줄로 보여주지 않기 위함.
        setRooms(dedupeRooms(found));
        setScanning(false);
      })
      .catch(() => {
        setRooms([]);
        setScanning(false);
      });
  }, []);

  const handleJoinRoom = useCallback((): void => {
    setScreen('roomList');
    refreshRooms();
  }, [refreshRooms]);

  const handleCreateRoom = useCallback(
    (game: GameId): void => {
      setMenuError(undefined);
      void (async (): Promise<void> => {
        const room = new Room({ name: `${nickname}의 방`, game, host: nickname });
        try {
          const server = await startServer(room);
          serverRef.current = server;
          const discovery = await startDiscovery(() => room.info());
          discoveryRef.current = discovery;
          const addr = firstNonInternalIPv4();
          setHostAddr(addr !== undefined ? `${addr}:${server.port}` : `?:${server.port}`);
          await connectAndWire('127.0.0.1', server.port, nickname);
        } catch (err) {
          cleanupResources();
          setHostAddr(undefined);
          // net/connection.ts가 이미 확립한 패턴과 동일: 원인은 cause로 보존하고, 사용자에게는
          // 이 앱의 다른 모든 화면과 마찬가지로 한국어 문장만 보여준다. 실제로 밟히는 경로다 —
          // 이전에 띄운 서버가 아직 포트를 쥐고 있거나, 방 만들기를 연달아 시도하면
          // startServer가 EADDRINUSE류의 영어 Node 에러로 reject한다.
          const wrapped = new Error('방을 만들지 못했습니다. 포트가 이미 사용 중일 수 있습니다.', {
            cause: err,
          });
          console.error('[card-night] 방 생성 실패:', wrapped);
          setMenuError(wrapped.message);
          setScreen('menu');
        }
      })();
    },
    [nickname, connectAndWire, cleanupResources],
  );

  /**
   * join 시도가 실패했을 때의 공통 처리. 'dup'(중복 또는 형식이 잘못된 닉네임)만 특별
   * 취급한다: 방 목록에 머물러 봐야 사용자가 닉네임을 바꿀 방법이 없으므로, Nickname
   * 화면으로 돌려보내 새 닉네임을 받는다. 그 외(full/playing/네트워크 오류)는 방 목록에
   * 남아 원인을 보여준다 — 방을 다시 고르거나 새로고침하면 되는 것들이기 때문이다.
   *
   * 서버 쪽 문구('사용할 수 없는 닉네임입니다 — 이미 사용 중이거나 형식이 올바르지
   * 않습니다.')를 그대로 쓴다 — 중복이라고 단정하면 형식 오류로 거절된 사람에게 거짓
   * 이유를 말하게 된다(server.ts의 동일한 이유와 같다).
   */
  const handleConnectError = useCallback((err: unknown): void => {
    if (err instanceof JoinError && err.code === 'dup') {
      setNicknameError(err.message);
      setScreen('nickname');
      return;
    }
    setRoomListError(err instanceof Error ? err.message : String(err));
  }, []);

  const handleSelectRoom = useCallback(
    (room: RoomInfo): void => {
      setRoomListError(undefined);
      // RoomInfo는 포트를 싣지 않는다(발견 프로토콜의 기존 제약) — 발견된 방은 언제나
      // DEFAULT_TCP_PORT로 접속한다.
      connectAndWire(room.addr, DEFAULT_TCP_PORT, nickname).catch(handleConnectError);
    },
    [connectAndWire, nickname, handleConnectError],
  );

  const handleManualConnect = useCallback(
    (host: string, port: number): void => {
      setRoomListError(undefined);
      connectAndWire(host, port, nickname).catch(handleConnectError);
    },
    [connectAndWire, nickname, handleConnectError],
  );

  const handleQuit = useCallback((): void => {
    cleanupResources();
    exit();
  }, [cleanupResources, exit]);

  const sendAction = useCallback((name: string, arg?: unknown): void => {
    connectionRef.current?.send({ type: 'action', name, arg });
  }, []);

  const handleStart = useCallback((): void => sendAction('start'), [sendAction]);
  const handleReplay = useCallback((): void => sendAction('replay'), [sendAction]);

  const returnToMenu = useCallback((): void => {
    cleanupResources();
    setHostAddr(undefined);
    setRoomState(null);
    setEventLog([]);
    setScreen('menu');
  }, [cleanupResources]);

  return (
    <Box flexDirection="column">
      {screen === 'nickname' && <Nickname onSubmit={handleNicknameSubmit} error={nicknameError} />}

      {screen === 'menu' && (
        <MainMenu
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuit={handleQuit}
          error={menuError}
        />
      )}

      {screen === 'roomList' && (
        <RoomList
          rooms={rooms}
          scanning={scanning}
          error={roomListError}
          onRefresh={refreshRooms}
          onSelect={handleSelectRoom}
          onManualConnect={handleManualConnect}
          onCancel={returnToMenu}
        />
      )}

      {(screen === 'lobby' || screen === 'game' || screen === 'result') && roomState && (
        <Box flexDirection="column">
          <Box borderStyle="round" paddingX={1}>
            <Text bold>
              {roomState.room.name} [{GAME_LABELS[roomState.room.game]}]
            </Text>
          </Box>

          {screen === 'lobby' && (
            <Lobby
              host={roomState.room.host}
              players={roomState.room.players}
              you={you}
              hostAddr={you === roomState.room.host ? hostAddr : undefined}
              onStart={handleStart}
            />
          )}

          {screen === 'game' && roomState.view && (
            <GameScreen
              view={roomState.view}
              you={you}
              send={sendAction}
              theme={initialTheme}
              game={roomState.room.game}
            />
          )}

          {screen === 'result' && roomState.result && (
            <Result
              ranking={roomState.result.ranking}
              youAreHost={you === roomState.room.host}
              onReplay={handleReplay}
              onLeave={returnToMenu}
            />
          )}

          <Box flexDirection="column" marginTop={1}>
            {eventLog.map((text, i) => (
              <Text key={i} dimColor>
                {text}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {screen === 'disconnected' && <Disconnected message={disconnectMessage} onConfirm={returnToMenu} />}
    </Box>
  );
}

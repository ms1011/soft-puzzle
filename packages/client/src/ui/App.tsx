import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import os from 'node:os';
import type { GameId, ServerMsg, RoomInfo, MafiaSettings } from '@soft-puzzle/core';
import { Room, resolveRespondAddr, startServer, startDiscovery } from '@soft-puzzle/server';
import type { RunningServer, RunningDiscovery } from '@soft-puzzle/server';
import { Connection, JoinError } from '../net/connection.js';
import { discoverRooms } from '../net/discover.js';
import { loadConfig, saveConfig } from '../config.js';
import type { Theme } from '../art/theme.js';
import { GAME_LABELS, ACTION_LABELS } from './gameLabels.js';
import { dedupeRooms, resolveRoomTarget } from './roomListUtils.js';
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
import { MafiaView } from './game/MafiaView.js';
import { DavinciView } from './game/DavinciView.js';
import { LiarView } from './game/LiarView.js';
import { IndianPokerView } from './game/IndianPokerView.js';
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
  mafia: MafiaView,
  davinci: DavinciView,
  liar: LiarView,
  indianPoker: IndianPokerView,
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

/** 수동 접속용으로 모든 비내부 IPv4 주소를 보여준다(WSL/VPN 주소가 앞에 와도 LAN 주소를 숨기지 않는다). */
function localIPv4Addresses(): string[] {
  return [...new Set(Object.values(os.networkInterfaces()).flatMap((addrs) =>
    (addrs ?? []).filter((iface) => iface.family === 'IPv4' && !iface.internal).map((iface) => iface.address),
  ))];
}

function GameScreen({
  view,
  you,
  send,
  theme,
  game,
  deadline,
}: GameViewProps & { game: GameId; deadline?: number }): React.JSX.Element {
  const View = GAME_VIEWS[game];
  return (
    <Box flexDirection="column">
      {deadline !== undefined && <TurnTimer deadline={deadline} />}
      <View view={view} you={you} send={send} theme={theme} />
      {/* 요구사항 4: 행동 바는 항상 지금 view.yourActions에서만 나온다 — 하드코딩된 목록이
       * 아니다. ACTION_LABELS는 세 엔진이 실제로 쓰는 액션 이름을 미리 채운 한국어 사전이고,
       * 거기 없는 액션(향후 새 액션 등)은 ActionBar 자체 계약대로 이름 그대로 폴백한다. */}
      <ActionBar actions={view.yourActions} labels={ACTION_LABELS} />
    </Box>
  );
}

function TurnTimer({ deadline }: { deadline: number }): React.JSX.Element {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const update = (): void => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return <Text color={remaining <= 15 ? 'red' : undefined}>⏱ 자동 처리까지 {remaining}초</Text>;
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
  // 중요사항 3: Connection.connect가 최대 5초 걸리는 동안(연결 성패가 갈리기 전) RoomList가
  // 계속 입력을 받으면, 두 번째 Enter가 같은 닉네임으로 두 번째 연결을 열고 서버가 그걸
  // 'dup'으로 거절해 방금 성공한 첫 연결까지 Nickname 화면으로 튕겨내며 고아로 만든다.
  const [connecting, setConnecting] = useState(false);
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

  const handleChangeNickname = useCallback((): void => {
    setNicknameError(undefined);
    setScreen('nickname');
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
    (game: GameId, mafiaSettings?: MafiaSettings): void => {
      setMenuError(undefined);
      void (async (): Promise<void> => {
        const room = new Room({ name: `${nickname}의 방`, game, host: nickname, mafiaSettings });
        try {
          const server = await startServer(room);
          serverRef.current = server;
          const addresses = localIPv4Addresses();
          setHostAddr(
            addresses.length > 0 ? addresses.map((address) => `${address}:${server.port}`).join(', ') : `?:${server.port}`,
          );
          // 방마다 하나의 주소를 고정 광고하면 WSL/VPN 같은 가상 어댑터 주소가 실제 LAN 주소보다
          // 먼저 선택될 수 있다. UDP 요청을 보낸 참가자의 IP와 같은 서브넷 주소를 응답마다 골라
          // TCP 포트까지 함께 광고한다. 따라서 서로 다른 네트워크 대역의 참가자도 자기 대역에서
          // 도달 가능한 주소를 받는다.
          const discovery = await startDiscovery((remoteAddress) => {
            const address = resolveRespondAddr(remoteAddress);
            return { ...room.info(), addr: address.length > 0 ? `${address}:${server.port}` : '' };
          });
          discoveryRef.current = discovery;
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
          console.error('[soft-puzzle] 방 생성 실패:', wrapped);
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
      if (connecting) return; // RoomList가 이미 입력을 막지만, 한 겹 더 방어한다(중요사항 3).
      setRoomListError(undefined);
      setConnecting(true);
      // 중요사항 1: room.addr는 이제 "ip:port"로 광고된다 — resolveRoomTarget이 그걸 풀고,
      // 포트가 없는(옛 응답기) addr만 DEFAULT_TCP_PORT로 폴백한다.
      const { host, port } = resolveRoomTarget(room);
      connectAndWire(host, port, nickname)
        .catch(handleConnectError)
        .finally(() => setConnecting(false));
    },
    [connecting, connectAndWire, nickname, handleConnectError],
  );

  const handleManualConnect = useCallback(
    (host: string, port: number): void => {
      if (connecting) return;
      setRoomListError(undefined);
      setConnecting(true);
      connectAndWire(host, port, nickname)
        .catch(handleConnectError)
        .finally(() => setConnecting(false));
    },
    [connecting, connectAndWire, nickname, handleConnectError],
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
  const handleToLobby = useCallback((): void => sendAction('toLobby'), [sendAction]);

  const returnToMenu = useCallback((): void => {
    cleanupResources();
    setHostAddr(undefined);
    setRoomState(null);
    setEventLog([]);
    setScreen('menu');
  }, [cleanupResources]);

  return (
    <Box flexDirection="column">
      {screen === 'nickname' && (
        <Nickname
          initialValue={nickname}
          onSubmit={handleNicknameSubmit}
          error={nicknameError}
          onCancel={nickname ? () => setScreen('menu') : undefined}
        />
      )}

      {screen === 'menu' && (
        <MainMenu
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onChangeNickname={handleChangeNickname}
          onQuit={handleQuit}
          error={menuError}
        />
      )}

      {screen === 'roomList' && (
        <RoomList
          rooms={rooms}
          scanning={scanning}
          connecting={connecting}
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
              game={roomState.room.game}
              onStart={handleStart}
              onLeave={returnToMenu}
            />
          )}

          {screen === 'game' && roomState.view && (
            <GameScreen
              view={roomState.view}
              you={you}
              send={sendAction}
              theme={initialTheme}
              game={roomState.room.game}
              deadline={roomState.deadline}
            />
          )}

          {screen === 'result' && roomState.result && (
            <Result
              ranking={roomState.result.ranking}
              game={roomState.room.game}
              youAreHost={you === roomState.room.host}
              onReplay={handleReplay}
              onToLobby={handleToLobby}
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

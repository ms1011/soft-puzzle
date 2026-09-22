import React, { useEffect, useState } from 'react';
import { Box, useStdout } from 'ink';

/** 게임 화면은 100칼럼에 맞춰 그려진다(야추 6인 점수표 등) — 여기에 채팅 패널 폭을 더한 값. */
export const SIDE_CHAT_WIDTH = 40;
export const SIDE_CHAT_MIN_COLUMNS = 100 + SIDE_CHAT_WIDTH;

export type ChatLayout = 'side' | 'bottom';

/** 터미널 폭을 읽고, 창 크기가 바뀌면 다시 그린다. columns를 모르는 출력(파이프 등)은 80으로 본다. */
function useTerminalColumns(): number {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(() => stdout.columns ?? 80);
  useEffect(() => {
    const update = (): void => setColumns(stdout.columns ?? 80);
    update();
    stdout.on('resize', update);
    return () => {
      stdout.off('resize', update);
    };
  }, [stdout]);
  return columns;
}

export interface RoomLayoutProps {
  /** 게임/로비/결과 화면과 알림 로그. */
  main: React.ReactNode;
  /** 정해진 배치에 맞춰 채팅 영역을 그린다. */
  chat: (layout: ChatLayout) => React.ReactNode;
}

/**
 * 방 화면 배치. 게임 화면 폭(100칼럼)과 채팅 패널을 나란히 놓을 만큼 넓으면 채팅을 오른쪽에,
 * 아니면 아래에 둔다 — 세로로만 쌓으면 짧은 터미널에서 게임 화면이 위로 밀려 올라가기 때문이다.
 */
export function RoomLayout({ main, chat }: RoomLayoutProps): React.JSX.Element {
  const side = useTerminalColumns() >= SIDE_CHAT_MIN_COLUMNS;
  if (!side) {
    return (
      <Box flexDirection="column">
        {main}
        {chat('bottom')}
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" flexGrow={1}>
        {main}
      </Box>
      <Box width={SIDE_CHAT_WIDTH} flexShrink={0}>
        {chat('side')}
      </Box>
    </Box>
  );
}

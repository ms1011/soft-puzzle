import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface DisconnectedProps {
  message: string;
  onConfirm: () => void;
}

/**
 * 연결 종료 화면. onClose는 항상 "세션이 정상적으로 끝났다"는 뜻이다(결정 6) — 호스트가
 * 방을 나가면 그 호스트가 in-process로 띄운 서버가 죽으면서 전원의 소켓이 함께 끊기는 것이
 * 이 아키텍처의 정상적인 종료 방식이다. 사용자가 직접 나간 경우(close())는 애초에 이
 * 화면까지 오지 않는다 — Connection이 그 경우를 onClose로 통지하지 않는다.
 */
export function Disconnected({ message, onConfirm }: DisconnectedProps): React.JSX.Element {
  useInput((_input, key) => {
    if (key.return) onConfirm();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="red">{message}</Text>
      <Text>[Enter] 메뉴로</Text>
    </Box>
  );
}

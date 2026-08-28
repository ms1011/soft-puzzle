import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export interface NicknameProps {
  /** Enter로 제출된, 이미 NFC 정규화·trim된 닉네임을 받는다. */
  onSubmit: (nickname: string) => void;
  /** 직전 시도(중복/형식 오류 등)의 서버 거절 메시지가 있으면 보여준다. */
  error?: string;
}

/**
 * 닉네임 입력 화면. 저장된 닉네임이 있으면 App이 이 화면 자체를 건너뛴다 — 여기서는 새로
 * 입력받는 경우만 다룬다.
 *
 * 결정 3(NFC 정규화)을 여기서, 입력이 이 화면을 떠나는 유일한 지점(제출 시)에 적용한다: macOS의
 * 한글 입력기가 만드는 분해형(NFD) 문자열은 (a) displayWidth 계산을 틀리게 하고 (b) 다른
 * 플랫폼에서 입력된 조합형(NFC) 문자열과 바이트 단위로 달라 서버의 중복 닉네임 판정을
 * 우회한다 — 그래서 App(저장·전송)에 넘기기 전에 정규화를 끝낸다.
 */
export function Nickname({ onSubmit, error }: NicknameProps): React.JSX.Element {
  const [value, setValue] = useState('');

  const handleSubmit = (raw: string): void => {
    const normalized = raw.normalize('NFC').trim();
    if (normalized.length === 0) return;
    onSubmit(normalized);
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>소프트퍼즐</Text>
      <Text>닉네임을 입력하세요:</Text>
      <Box>
        <Text>{'> '}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
      </Box>
      {error !== undefined && <Text color="red">{error}</Text>}
    </Box>
  );
}

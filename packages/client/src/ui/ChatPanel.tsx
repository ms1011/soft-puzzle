import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { ChatChannel } from '@soft-puzzle/core';
import type { ChatLayout } from './RoomLayout.js';

export interface ChatLine {
  from: string;
  text: string;
  channel: ChatChannel;
}

export interface ChatPanelProps {
  /** 표시할 채팅 — App이 최근 몇 줄로 잘라 넘긴다. */
  lines: ChatLine[];
  open: boolean;
  /** 지금 보낼 수 있는지(마피아의 밤 시민 등은 false). false면 Tab을 무시한다. */
  canSend: boolean;
  /** 지금 보내면 전달될 채널 — 입력줄 앞 태그로 보여준다. */
  channel: ChatChannel | null;
  onOpen: () => void;
  onClose: () => void;
  onSend: (text: string) => void;
  /** 'side'면 넓은 터미널 오른쪽에 놓이는 테두리 패널로, 기본 'bottom'은 게임 화면 아래 줄들로 그린다. */
  layout?: ChatLayout;
}

const CHANNEL_TAGS: Record<ChatChannel, string> = { all: '', mafia: '[마피아] ', dead: '[탈락자] ' };
const CHANNEL_COLORS: Record<ChatChannel, string | undefined> = { all: undefined, mafia: 'red', dead: 'gray' };

/**
 * 방 화면의 채팅 영역(아래 또는 오른쪽 — 배치는 RoomLayout이 정한다). Tab으로 입력줄을 열고 Enter로 보내며(입력줄은 열린 채 유지 — 대화는
 * 여러 줄로 이어지므로), Esc로 닫는다. Tab은 어떤 화면도 쓰지 않고, 한글 입력 상태에서도 글자로
 * 바뀌지 않는 키라 고른 것이다.
 */
export function ChatPanel({ lines, open, canSend, channel, onOpen, onClose, onSend, layout = 'bottom' }: ChatPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState('');

  useInput((_input, key) => {
    if (open && key.escape) onClose();
    else if (!open && key.tab && canSend) onOpen();
  });

  const handleSubmit = (raw: string): void => {
    const text = raw.normalize('NFC').trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  const side = layout === 'side';
  return (
    <Box
      flexDirection="column"
      flexGrow={side ? 1 : undefined}
      marginTop={side ? 0 : 1}
      borderStyle={side ? 'round' : undefined}
      paddingX={side ? 1 : 0}
    >
      {side && <Text bold>채팅</Text>}
      {lines.map((line, i) => (
        <Text key={i} color={CHANNEL_COLORS[line.channel]}>
          {CHANNEL_TAGS[line.channel]}
          {line.from}: {line.text}
        </Text>
      ))}
      {open ? (
        <Box flexDirection="column">
          <Box>
            <Text color={channel === null ? undefined : CHANNEL_COLORS[channel]}>
              {channel === null ? '' : CHANNEL_TAGS[channel]}
              {'> '}
            </Text>
            <TextInput value={draft} onChange={setDraft} onSubmit={handleSubmit} />
          </Box>
          <Text dimColor>Enter 전송 · Esc 닫기</Text>
        </Box>
      ) : (
        <Text dimColor>{canSend ? '[Tab] 채팅' : '지금은 채팅할 수 없습니다'}</Text>
      )}
    </Box>
  );
}

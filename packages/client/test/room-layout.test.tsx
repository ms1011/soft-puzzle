import React from 'react';
import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import { RoomLayout, SIDE_CHAT_MIN_COLUMNS } from '../src/ui/RoomLayout.js';
import { renderAtWidth } from './testUtils.js';

function Sample(): React.JSX.Element {
  return (
    <RoomLayout
      main={<Text>게임화면</Text>}
      chat={(layout) => <Text>채팅영역({layout})</Text>}
    />
  );
}

describe('RoomLayout', () => {
  it('넓은 터미널에서는 채팅을 게임 화면 오른쪽 같은 줄에 둔다', () => {
    const { lastFrame, unmount } = renderAtWidth(<Sample />, SIDE_CHAT_MIN_COLUMNS);
    const line = (lastFrame() ?? '').split('\n').find((l) => l.includes('게임화면')) ?? '';
    expect(line).toContain('채팅영역(side)');
    expect(line.indexOf('채팅영역')).toBeGreaterThan(line.indexOf('게임화면'));
    unmount();
  });

  it('좁은 터미널에서는 채팅을 게임 화면 아래에 둔다', () => {
    const { lastFrame, unmount } = renderAtWidth(<Sample />, SIDE_CHAT_MIN_COLUMNS - 1);
    const lines = (lastFrame() ?? '').split('\n');
    const mainRow = lines.findIndex((l) => l.includes('게임화면'));
    const chatRow = lines.findIndex((l) => l.includes('채팅영역(bottom)'));
    expect(mainRow).toBeGreaterThanOrEqual(0);
    expect(chatRow).toBeGreaterThan(mainRow);
    unmount();
  });
});

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { RoomInfo } from '@soft-puzzle/core';
import { Nickname } from '../src/ui/screens/Nickname.js';
import { Lobby } from '../src/ui/screens/Lobby.js';
import { Result } from '../src/ui/screens/Result.js';
import { RoomList } from '../src/ui/screens/RoomList.js';
import { ActionBar } from '../src/ui/game/ActionBar.js';

/** ink는 keypress를 batchedUpdates 안에서 동기적으로 처리하지만, 여러 stdin.write를
 * 연달아 보낼 때 렌더 반영 순서를 확실히 하기 위해 매크로태스크 하나만큼 양보한다. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

const ESC = '\x1B';
const DOWN_ARROW = `${ESC}[B`;

describe('Nickname 화면', () => {
  it('입력 후 Enter를 누르면 onSubmit이 입력값으로 호출된다', async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(<Nickname onSubmit={onSubmit} />);

    // useInput의 useEffect(raw mode 설정·리스너 등록)가 마운트 커밋 이후에나 붙는다 — 그
    // 전에 보낸 키 입력은 아무도 듣지 않아 유실된다. 첫 keystroke 전에 한 틱 양보해야 한다.
    await tick();
    stdin.write('hong');
    await tick();
    stdin.write('\r');
    await tick();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('hong');
    unmount();
  });

  it('빈 입력에서 Enter를 눌러도 onSubmit이 호출되지 않는다', async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(<Nickname onSubmit={onSubmit} />);

    await tick();
    stdin.write('\r');
    await tick();

    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });
});

describe('Lobby 화면', () => {
  it('참가자 목록을 그리고, 호스트에게만 ★ 표시를 붙인다', () => {
    const { lastFrame, unmount } = render(
      <Lobby host="철수" players={['철수', '영희']} you="영희" onStart={() => {}} />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');

    expect(frame).toContain('철수');
    expect(frame).toContain('영희');

    const hostLine = lines.find((l) => l.includes('철수'));
    const otherLine = lines.find((l) => l.includes('영희') && !l.includes('철수'));
    expect(hostLine).toBeDefined();
    expect(hostLine).toContain('★');
    expect(otherLine).toBeDefined();
    expect(otherLine).not.toContain('★');

    unmount();
  });

  it('빈 참가자 목록이면(버그가 있다면) 이 테스트가 실패한다', () => {
    const { lastFrame, unmount } = render(
      <Lobby host="철수" players={[]} you="철수" onStart={() => {}} />,
    );
    // players가 비었으면 아무 이름도 렌더되지 않는다 — 위 테스트가 참가자 렌더 자체가 깨진
    // 회귀(예: players prop을 아예 안 쓰는 실수)를 잡아내는지 대조하기 위한 음성 대조군.
    expect(lastFrame() ?? '').not.toContain('철수');
    unmount();
  });
});

describe('ActionBar', () => {
  it('actions에 있는 것만 표시하고, labels로 한국어 라벨을 붙인다', () => {
    const { lastFrame, unmount } = render(
      <ActionBar actions={['bet', 'stand']} labels={{ bet: '베팅', hit: '히트', stand: '스탠드' }} />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('베팅');
    expect(frame).toContain('스탠드');
    expect(frame).not.toContain('히트'); // actions에 없는 'hit'의 라벨은 절대 보이면 안 된다
    unmount();
  });

  it('행동이 없으면(actions가 빈 배열) "할 수 있는 행동이 없습니다" 안내로 대체한다', () => {
    const { lastFrame, unmount } = render(<ActionBar actions={[]} labels={{ bet: '베팅' }} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('할 수 있는 행동이 없습니다');
    expect(frame).not.toContain('베팅'); // 안내문 자체에 라벨 텍스트가 우연히 안 섞였는지도 확인
    unmount();
  });
});

describe('Result 화면', () => {
  it('ranking을 받은 순서 그대로(순위 순서대로) 그린다', () => {
    const ranking = [
      { nickname: '철수', detail: '21점' },
      { nickname: '영희', detail: '18점' },
      { nickname: '민수', detail: '15점' },
    ];
    const { lastFrame, unmount } = render(
      <Result
        ranking={ranking}
        youAreHost={false}
        onReplay={() => {}}
        onLeave={() => {}}
        onToLobby={() => {}}
      />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('철수');
    expect(frame).toContain('영희');
    expect(frame).toContain('민수');
    expect(frame.indexOf('철수')).toBeLessThan(frame.indexOf('영희'));
    expect(frame.indexOf('영희')).toBeLessThan(frame.indexOf('민수'));

    unmount();
  });

  it('방장이 아니면 [r]/[q] 안내 대신 대기 문구를 보여준다', () => {
    const { lastFrame, unmount } = render(
      <Result
        ranking={[{ nickname: '철수', detail: '1위' }]}
        youAreHost={false}
        onReplay={() => {}}
        onLeave={() => {}}
        onToLobby={() => {}}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[r]');
    expect(frame).toContain('기다리는');
    unmount();
  });

  it('방장이 Result에서 [l]을 누르면 onToLobby가 호출된다(중요사항 2 — 로비 복귀의 유일한 진입점)', async () => {
    const onToLobby = vi.fn();
    const { stdin, unmount } = render(
      <Result
        ranking={[{ nickname: '철수', detail: '1위' }]}
        youAreHost={true}
        onReplay={() => {}}
        onLeave={() => {}}
        onToLobby={onToLobby}
      />,
    );
    await tick();
    stdin.write('l');
    await tick();
    expect(onToLobby).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('방장이 아니면 [l]을 눌러도 onToLobby가 호출되지 않는다', async () => {
    const onToLobby = vi.fn();
    const { stdin, unmount } = render(
      <Result
        ranking={[{ nickname: '철수', detail: '1위' }]}
        youAreHost={false}
        onReplay={() => {}}
        onLeave={() => {}}
        onToLobby={onToLobby}
      />,
    );
    await tick();
    stdin.write('l');
    await tick();
    expect(onToLobby).not.toHaveBeenCalled();
    unmount();
  });
});

describe('RoomList 화면 (치명적 결함, 중요사항 3)', () => {
  function room(overrides: Partial<RoomInfo> = {}): RoomInfo {
    return { room: '테스트 방', game: 'blackjack', players: '1/6', addr: '192.168.0.5:7420', ...overrides };
  }

  it('rooms가 새로고침으로 줄어들면 커서가 새 목록 범위 안으로 클램프된다', async () => {
    const rooms = [room({ room: '방A' }), room({ room: '방B' })];
    const onSelect = vi.fn();
    const { stdin, rerender, lastFrame, unmount } = render(
      <RoomList
        rooms={rooms}
        scanning={false}
        connecting={false}
        onRefresh={() => {}}
        onSelect={onSelect}
        onManualConnect={() => {}}
        onCancel={() => {}}
      />,
    );
    await tick();
    stdin.write('[B'); // 아래 방향키 — 커서를 두 번째 방(index 1)로.
    await tick();
    expect(lastFrame() ?? '').toMatch(/> .*방B/);

    // 새로고침으로 목록이 한 개로 줄었다고 가정 — 커서(1)가 범위 밖이 된다.
    rerender(
      <RoomList
        rooms={[room({ room: '방A' })]}
        scanning={false}
        connecting={false}
        onRefresh={() => {}}
        onSelect={onSelect}
        onManualConnect={() => {}}
        onCancel={() => {}}
      />,
    );
    await tick();

    stdin.write('\r');
    await tick();

    // 클램프되지 않았다면 onSelect(undefined)가 호출되며(수정 전 버그) 앱이 죽는다.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(room({ room: '방A' }));
    unmount();
  });

  it('rooms가 여러 번 급격히 줄어드는 동안에도 onSelect가 절대 undefined로 호출되지 않는다', async () => {
    // 커서를 목록 끝(index 2)까지 옮긴 뒤 rooms를 1개로 확 줄인다 — effect 클램프가 selected를
    // 정리해야 정상이고, 혹시 그 effect가 어떤 경로로든 못 따라잡더라도 Enter 핸들러 자체의
    // rooms[selected] 가드(치명적 결함 수정의 두 번째 방어선)가 undefined 전달을 막아야 한다.
    const onSelect = vi.fn();
    const rooms = [room({ room: '방A' }), room({ room: '방B' }), room({ room: '방C' })];
    const { stdin, rerender, unmount } = render(
      <RoomList
        rooms={rooms}
        scanning={false}
        connecting={false}
        onRefresh={() => {}}
        onSelect={onSelect}
        onManualConnect={() => {}}
        onCancel={() => {}}
      />,
    );
    await tick();
    stdin.write('[B');
    stdin.write('[B'); // 커서를 마지막(index 2, 방C)으로.
    await tick();

    rerender(
      <RoomList
        rooms={[room({ room: '방A' })]}
        scanning={false}
        connecting={false}
        onRefresh={() => {}}
        onSelect={onSelect}
        onManualConnect={() => {}}
        onCancel={() => {}}
      />,
    );
    await tick();
    stdin.write('\r');
    await tick();

    for (const call of onSelect.mock.calls) {
      expect(call[0]).not.toBeUndefined();
    }
    unmount();
  });

  it('connecting이 true면 "연결 중..." 안내를 보여주고 Enter를 포함한 모든 입력을 무시한다', async () => {
    const onSelect = vi.fn();
    const onRefresh = vi.fn();
    const rooms = [room()];
    const { stdin, lastFrame, unmount } = render(
      <RoomList
        rooms={rooms}
        scanning={false}
        connecting={true}
        onRefresh={onRefresh}
        onSelect={onSelect}
        onManualConnect={() => {}}
        onCancel={() => {}}
      />,
    );
    await tick();
    expect(lastFrame() ?? '').toContain('연결 중...');

    stdin.write('\r');
    stdin.write('r');
    await tick();

    expect(onSelect).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    unmount();
  });
});

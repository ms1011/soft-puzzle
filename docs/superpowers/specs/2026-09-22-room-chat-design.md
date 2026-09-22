# 방 채팅 설계

마피아·라이어 게임은 대화가 핵심이다. 서버는 이미 `chat` 메시지를 전원에게 `event`로 중계하지만, 클라이언트에는 입력 수단도 전용 표시 영역도 없다. 이 문서는 모든 방 화면(로비·게임·결과)에서 쓰는 채팅과, 마피아 게임의 정석 공개 범위 규칙을 정의한다.

## 결정 사항

- 채팅은 모든 게임의 로비·게임·결과 화면에서 쓸 수 있다.
- 마피아는 정석 규칙을 따른다.
  - 낮: 생존자 전원 채널(`all`).
  - 밤: 마피아끼리만 비밀 채널(`mafia`). 다른 생존자는 입력할 수 없다.
  - 탈락자: 낮·밤 모두 탈락자끼리만 채널(`dead`). 생존자에게는 절대 전달하지 않는다.
- 라이어 등 나머지 게임은 제한 없이 전원 채널이다.
- 수신자 결정은 서버에서 한다. 클라이언트 필터링은 쓰지 않는다(netcat으로 비밀 채팅이 새어 나간다).

## 프로토콜 (core)

```ts
export type ChatChannel = 'all' | 'mafia' | 'dead';
// ServerMsg에 추가
| { type: 'chat'; from: string; text: string; channel: ChatChannel }
```

- 채팅은 더 이상 `event`로 보내지 않는다. 구버전 클라이언트는 모르는 `type`을 무시하므로 깨지지 않는다(채팅만 안 보인다).
- `MAX_CHAT_LENGTH = 200`. 서버가 trim 후 초과분을 잘라낸다.

## 엔진 훅 (core)

```ts
export type ChatRoute =
  | { ok: true; channel: ChatChannel; to: string[] }
  | { ok: false; reason: string };

interface GameEngine {
  chatRoute?(sender: string): ChatRoute; // 선택 — 없으면 전원 채널
}
```

`MafiaEngine.chatRoute`:

| 발신자 | 단계 | 결과 |
|---|---|---|
| 탈락자 | 낮·밤 | `dead` → 탈락자 전원 |
| 생존 마피아 | 밤 | `mafia` → 생존 마피아 |
| 생존 비마피아 | 밤 | 거절: "밤에는 채팅할 수 없습니다." |
| 생존자 | 낮 | `all` → 생존자 전원 |

마피아 view에 `chat: { canSend: boolean; channel: ChatChannel | null }`를 더한다. 클라이언트가 채널 안내와 입력 가능 여부를 보여주는 데 쓴다.

## Room (server)

- `phase === 'playing'`이고 엔진에 `chatRoute`가 있을 때만 훅을 쓴다. 로비·결과, 훅이 없는 엔진은 방 전원에게 `all`로 보낸다.
- 훅의 `to`는 현재 방 참가자와 교집합을 취한다(이미 나간 사람에게 보내지 않는다).
- 거절되면 발신자에게만 `event`로 사유를 보낸다.
- Room은 여전히 게임 종류를 분기하지 않는다.

## 클라이언트

- **입력 잠금**: `InputLockContext`와 `useScreenInput(handler)` 훅(`useInput(handler, { isActive: !locked })`). 방 화면(Lobby·Result·각 게임 View)의 `useInput`을 이 훅으로 바꾼다. 채팅 입력 중에는 게임 키가 동작하지 않는다.
- **키**: Tab으로 채팅 입력 열기(한글 입력 상태에서도 동작하는 키). Enter 전송(입력창 유지), Esc 닫기. 빈 입력은 보내지 않는다.
- **ChatPanel**: 최근 채팅 8줄. 채널 태그 `[마피아]`(빨강), `[탈락자]`(회색). 닫혀 있으면 `[Tab] 채팅` 안내, `view.chat.canSend === false`면 "지금은 채팅할 수 없습니다" 안내를 보이고 Tab을 무시한다.
- 채팅 기록은 방을 떠나거나 연결이 끊기면 비운다. 게임 이벤트 로그(5줄)와 분리한다.

## 테스트

- core: `MafiaEngine.chatRoute` 단계·역할별 4가지 경우, view의 `chat` 필드.
- server: 수신자 라우팅(밤 마피아 비밀 채팅, 탈락자 격리), 거절 사유 event, 로비·훅 없는 엔진의 전원 전달, 200자 자르기.
- client: ChatPanel 렌더(채널 태그·안내), Tab→입력→Enter 전송, 입력 중 화면 키 잠금.

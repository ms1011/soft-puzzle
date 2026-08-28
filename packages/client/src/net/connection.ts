import net from 'node:net';
import { encodeMsg, NdjsonDecoder } from '@soft-puzzle/core';
import type { ClientMsg, ServerMsg } from '@soft-puzzle/core';

type JoinErrorMsg = Extract<ServerMsg, { type: 'error' }>;
type JoinedMsg = Extract<ServerMsg, { type: 'joined' }>;

/** join이 서버로부터 error로 거절되었을 때 던지는 예외. code는 UI가 분기하는 데, message는 그대로 보여주는 데 쓴다. */
export class JoinError extends Error {
  readonly code: JoinErrorMsg['code'];

  constructor(code: JoinErrorMsg['code'], message: string) {
    super(message);
    this.name = 'JoinError';
    this.code = code;
  }
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

function isServerMsgLike(v: unknown): v is { type: string } {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

/**
 * 서버로의 TCP 연결 하나. connect()가 소켓 개설 → join 송신 → joined 수신까지의 핸드셰이크를
 * 끝내고 나서야 인스턴스를 돌려준다. 그 뒤로는 순수하게 메시지 송수신과 종료 통지만 담당한다 —
 * 로비/게임 로직은 전혀 모른다.
 */
export class Connection {
  /**
   * 서버가 실제로 등록한 정규화(trim된) 닉네임 — join()에 넘긴 원본 문자열과 다를 수 있다.
   * state.room.players/view의 각 플레이어 키가 전부 이 정규화된 형태이므로, "나"를 식별하려면
   * (내 행 강조, 내 패 찾기, 내 턴인지 판정 등) 호출자가 넘긴 원본이 아니라 이 값을 써야 한다.
   */
  readonly nickname: string;
  private readonly socket: net.Socket;
  private readonly decoder: NdjsonDecoder;
  private readonly messageCbs: Array<(msg: ServerMsg) => void> = [];
  private readonly closeCbs: Array<() => void> = [];
  /**
   * onMessage 콜백이 아직 하나도 등록되지 않은 시점에 도착한 메시지를 담아둔다. join 성공 직후
   * 서버가 같은 TCP 청크로 joined와 초기 state를 함께 보내는 경우가 실제로(특히 loopback에서)
   * 흔하다 — connect()가 joined만 소비하고 나머지를 버리면 첫 상태 갱신을 통째로 잃는다.
   */
  private pendingMessages: ServerMsg[] = [];
  private closeFired = false;
  private userClosed = false;

  private constructor(socket: net.Socket, decoder: NdjsonDecoder, nickname: string, initialPending: ServerMsg[]) {
    this.socket = socket;
    this.decoder = decoder;
    this.nickname = nickname;
    this.pendingMessages = initialPending;

    this.socket.on('data', (chunk: Buffer) => {
      let parsed: unknown[];
      try {
        parsed = this.decoder.push(chunk);
      } catch {
        return; // NdjsonDecoder는 계약상 던지지 않지만, 네트워크발 데이터는 무엇도 신뢰하지 않는다.
      }
      for (const raw of parsed) this.dispatch(raw as ServerMsg);
    });
    this.socket.on('close', () => this.fireClose());
    // handshake 이후 'error'를 아무도 듣지 않으면 Node가 프로세스를 죽인다. 'close'가 항상 뒤이어
    // 발생하므로(핸들 종료의 유일한 진짜 신호) 실제 통지는 fireClose 쪽에서만 한다.
    this.socket.on('error', () => {
      /* close 이벤트로 통지가 이어진다 — 여기서는 그저 unhandled error를 막을 뿐이다. */
    });
  }

  private dispatch(msg: ServerMsg): void {
    if (this.messageCbs.length === 0) {
      this.pendingMessages.push(msg);
      return;
    }
    for (const cb of this.messageCbs) cb(msg);
  }

  private fireClose(): void {
    if (this.closeFired || this.userClosed) return;
    this.closeFired = true;
    for (const cb of this.closeCbs) cb();
  }

  send(msg: ClientMsg): void {
    this.socket.write(encodeMsg(msg));
  }

  onMessage(cb: (msg: ServerMsg) => void): void {
    this.messageCbs.push(cb);
    if (this.pendingMessages.length > 0) {
      const buffered = this.pendingMessages;
      this.pendingMessages = [];
      for (const m of buffered) cb(m);
    }
  }

  /** 소켓이 끊겼음을 통지한다(호스트 이탈이 이 아키텍처에서 세션이 끝나는 정상적인 방식이다). 정확히 한 번 발화하며, close()를 직접 호출한 경우에는 발화하지 않는다. */
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }

  /** 로컬에서 의도적으로 연결을 끊는다. 이 호출로 인한 종료는 onClose로 통지되지 않는다 — 이미 원인을 아는 호출자에게 "호스트가 나갔다"는 오해를 주지 않기 위함이다. */
  close(): void {
    this.userClosed = true;
    this.socket.destroy();
  }

  /**
   * host:port로 접속해 join을 보내고 joined 수신까지 마친 뒤에만 resolve한다.
   * - 서버가 error로 거절하면 JoinError(code 포함)로 reject한다.
   * - 소켓이 연결 전에 닫히거나 에러가 나면 그 즉시 reject한다.
   * - timeoutMs 안에 joined/error 어느 쪽도 오지 않으면(잘못된 IP 등으로 응답 자체가 없는 경우)
   *   reject한다 — UI가 무한정 기다리지 않게 하기 위함.
   */
  static connect(
    host: string,
    port: number,
    nickname: string,
    timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
  ): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const decoder = new NdjsonDecoder();
      let settled = false;

      const detach = (): void => {
        clearTimeout(timer);
        socket.removeListener('connect', onConnect);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
      };

      const settleResolve = (conn: Connection): void => {
        if (settled) return;
        settled = true;
        detach();
        resolve(conn);
      };

      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        detach();
        socket.destroy();
        reject(err);
      };

      const timer = setTimeout(() => {
        settleReject(new Error('서버 연결 시간이 초과되었습니다.'));
      }, timeoutMs);

      const onConnect = (): void => {
        socket.write(encodeMsg({ type: 'join', nickname } satisfies ClientMsg));
      };

      const onData = (chunk: Buffer): void => {
        let parsed: unknown[];
        try {
          parsed = decoder.push(chunk);
        } catch {
          return;
        }
        for (let i = 0; i < parsed.length; i++) {
          const raw = parsed[i];
          if (!isServerMsgLike(raw)) continue;
          if (raw.type === 'joined') {
            const rest = parsed.slice(i + 1) as ServerMsg[];
            const canonicalNickname = (raw as JoinedMsg).you;
            settleResolve(new Connection(socket, decoder, canonicalNickname, rest));
            return;
          }
          if (raw.type === 'error') {
            const errMsg = raw as JoinErrorMsg;
            settleReject(new JoinError(errMsg.code, errMsg.message));
            return;
          }
          // joined 이전에 다른 타입은 프로토콜상 오지 않는다 — 방어적으로 무시하고 계속 본다.
        }
      };

      const onError = (err: Error): void => {
        // 원본 에러(예: 'connect ECONNREFUSED 192.168.0.5:7420')를 그대로 UI에 보이면 이 앱의
        // 다른 모든 화면과 달리 영어 Node 에러가 노출된다 — 잘못된 IP/포트 수동 입력은 Task 12가
        // 제공하는 실제 사용자 경로라 이 경로는 실제로 밟힌다. 원인은 cause로 남겨 디버깅은
        // 여전히 가능하게 한다.
        settleReject(new Error('서버에 연결할 수 없습니다.', { cause: err }));
      };

      const onClose = (): void => {
        settleReject(new Error('서버와 연결이 끊어졌습니다.'));
      };

      socket.on('connect', onConnect);
      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);
    });
  }
}

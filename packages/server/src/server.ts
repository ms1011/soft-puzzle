import net from 'node:net';
import { encodeMsg, NdjsonDecoder, DEFAULT_TCP_PORT } from '@card-night/core';
import type { ClientMsg, ServerMsg } from '@card-night/core';
import type { Room } from './room.js';

export interface RunningServer {
  port: number;
  /** 실제로 바인딩된 로컬 주소 문자열(예: '0.0.0.0' 또는 '::'). tryListen이 호스트를 지정하지
   * 않고 listen해 와일드카드에 묶인다는 사실은 이 게임에서 가장 결정적인 설정이라(중요사항
   * 5 — 예전에 실제로 127.0.0.1로 묶인 채 나간 적이 있다), 테스트가 추측이 아니라 이 값을 직접
   * 확인할 수 있도록 내보낸다. */
  address: string;
  close(): Promise<void>;
}

const MAX_PORT_RETRIES = 10;

type JoinErrorCode = Extract<ServerMsg, { type: 'error' }>['code'];

function isJoinMsg(raw: unknown): raw is { type: 'join'; nickname: string } {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { type?: unknown }).type === 'join' &&
    typeof (raw as { nickname?: unknown }).nickname === 'string'
  );
}

/**
 * room.join()이 돌려주는 실패 코드를 한국어 메시지로 번역한다.
 *
 * 'dup'은 Room 안에서 "이미 사용 중인 닉네임"과 "형식이 잘못된 닉네임(빈 문자열/공백만/32자
 * 초과)"을 모두 같은 코드로 뭉뚱그려 보고한다(join()의 반환 타입이 'full'|'dup'|'playing'으로
 * 고정돼 있어 새 코드를 추가할 수 없다). 그래서 여기서 "이미 사용 중입니다"라고 단정하면 형식
 * 오류로 거절된 사람에게 거짓 이유를 말하게 된다 — 두 원인을 모두 정직하게 포괄하는 문구를 쓴다.
 *
 * 'playing' 코드는 phase가 'playing'뿐 아니라 'result'(스코어보드가 떠 있는 방)일 때도
 * 돌아온다(room.ts의 join() 참고 — code enum 자체는 늘릴 수 없어 phase를 별도로 실어 보낸다).
 * toLobby가 생기기 전에는 이 방이 로비로 돌아올 길이 없어 "게임이 이미 진행 중"이라는 문구를
 * 보게 될 일이 사실상 없었지만, 이제는 흔한 실제 경로다 — 게임 중이라고 오해하게 두지 않고
 * result 전용 문구를 쓴다.
 */
function errorMessageFor(code: 'full' | 'dup' | 'playing', phase?: 'lobby' | 'playing' | 'result'): string {
  switch (code) {
    case 'full':
      return '방이 가득 찼습니다.';
    case 'dup':
      return '사용할 수 없는 닉네임입니다 — 이미 사용 중이거나 형식이 올바르지 않습니다.';
    case 'playing':
      return phase === 'result'
        ? '게임이 끝나고 결과를 보는 중입니다. 방장이 로비로 돌아가면 입장할 수 있습니다.'
        : '게임이 이미 진행 중이라 입장할 수 없습니다.';
  }
}

/**
 * Room을 실제 TCP 소켓에 연결한다. 게임/로비 로직은 전혀 모른다 — 아는 것은 소켓↔닉네임 바인딩과
 * NDJSON 프레이밍뿐이고, 그 밖의 모든 판단은 Room에 위임한다.
 *
 * 포트가 이미 사용 중이면(EADDRINUSE) +1씩 올려가며 최대 MAX_PORT_RETRIES(10)번 재시도한다.
 */
export function startServer(room: Room, preferredPort: number = DEFAULT_TCP_PORT): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    // 닉네임 → 소켓. Room이 onSend로 넘겨주는 닉네임은 항상 이 맵의 키와 일치하는
    // "정규화된(trim된)" 형태다 — 아래 handleFirstMessage의 주석 참고.
    const sockets = new Map<string, net.Socket>();
    // close()에서 정리해야 할 전체 연결(아직 join하지 못한 소켓 포함).
    const openSockets = new Set<net.Socket>();
    // room.join() 호출이 진행되는 동안(그 안에서 동기적으로 broadcastState()가 실행되는 동안)만
    // non-null이다 — 그 사이에 "아직 sockets에 등록되지 않은 닉네임" 앞으로 온 메시지를 잠시
    // 담아둔다. 아래 handleFirstMessage의 주석 참고.
    let pendingJoinBuffer: { nickname: string; msg: ServerMsg }[] | null = null;

    // Room은 (정규화된 닉네임, 메시지) 쌍만 넘겨준다 — 소켓을 전혀 모른다.
    room.onSend((nickname, msg) => {
      const sock = sockets.get(nickname);
      if (sock !== undefined) {
        // 이미 등록된(=한 번이라도 join에 성공한) 닉네임이다. 소켓이 아직 살아 있으면 보내고,
        // 죽었다면(원격 끊김으로 destroyed는 이미 true인데 close 이벤트가 아직 비동기로 도착
        // 전인 그 찰나) 그냥 버린다 — 절대로 아래 pendingJoinBuffer로 떨어뜨리면 안 된다.
        // 그리로 떨어지면 지금 한창 처리 중인 "다른" 소켓의 join()이 이 메시지를 자기 몫으로
        // 착각해 엉뚱한 닉네임으로 자신을 등록해버리는 사고가 난다.
        if (!sock.destroyed) sock.write(encodeMsg(msg));
        return;
      }
      // 등록된 적이 없는 닉네임이다 — 지금 한창 처리 중인 join() 호출 그 당사자 앞으로 온
      // 메시지일 수밖에 없다(Node는 싱글스레드라 이 콜백이 도는 동안 다른 join()이 끼어들 수
      // 없고, 이미 성공한 다른 모든 join은 반환 시점에 반드시 위 sockets 맵에 등록돼 있다).
      // join() 처리가 끝나는 즉시 이 소켓에 순서대로 흘려보낸다.
      pendingJoinBuffer?.push({ nickname, msg });
    });

    const server = net.createServer((socket) => {
      openSockets.add(socket);
      let nickname: string | undefined;
      let hasJoined = false;
      let hasLeft = false;
      const decoder = new NdjsonDecoder();

      // close 이벤트와 error 이벤트가 같은 소켓에 대해 둘 다 발생할 수 있어(예: 상대가
      // RST를 보내면 error 후 close) leave가 두 번 불리지 않도록 플래그로 막는다. join에
      // 성공하기 전에 끊긴 소켓은 nickname이 없으므로 room.leave를 아예 호출하지 않는다.
      const leaveOnce = (): void => {
        if (hasLeft) return;
        hasLeft = true;
        openSockets.delete(socket);
        if (nickname !== undefined) {
          sockets.delete(nickname);
          room.leave(nickname);
        }
      };

      const sendError = (code: JoinErrorCode, message: string): void => {
        socket.write(encodeMsg({ type: 'error', code, message } satisfies ServerMsg));
      };

      const handleFirstMessage = (raw: unknown): void => {
        if (!isJoinMsg(raw)) {
          sendError('bad-msg', '첫 메시지는 join이어야 합니다.');
          socket.end();
          return;
        }
        // Room은 join()이 받은 닉네임을 그대로 저장하지 않는다 — trim한 "정규화된" 형태를
        // players에 넣고 onSend도 그 형태로 부른다. join()의 반환값 자체는 그 문자열을
        // 알려주지 않으므로(반환 타입은 {ok:true}뿐), 다른 방법으로 알아내야 한다.
        //
        // room.join()은 성공 시 broadcastState()를 "같은 호출 안에서 동기적으로" 실행해
        // 전원(방금 들어온 사람 포함)에게 보낸다 — 그 콜백이 위 room.onSend()이고, 이 소켓은
        // 아직 sockets 맵에 없으므로 자기 자신 몫의 메시지는 pendingJoinBuffer에 쌓인다.
        // 그 버퍼 항목의 nickname이 바로 Room이 실제로 사용한 정규화된 문자열이다.
        pendingJoinBuffer = [];
        const result = room.join(raw.nickname);
        const buffered = pendingJoinBuffer;
        pendingJoinBuffer = null;

        if (!result.ok) {
          sendError(result.code, errorMessageFor(result.code, result.phase));
          socket.end();
          return;
        }
        const canonical = buffered[0]?.nickname;
        if (canonical === undefined) {
          // 도달 불가능해야 정상이다(성공한 join()은 반드시 broadcastState()로 이 소켓 몫의
          // state를 최소 한 번 버퍼에 남긴다) — 그래도 만에 하나 발생하면, room.join()은 이미
          // 성공해 이 플레이어를 room.players에 넣어버린 뒤다. 여기서 그냥 socket.end()만
          // 하면 이 플레이어는 소켓도 없이 room.players에 영원히 남아 유령이 되고, 그 뒤로
          // 들어오는 모든 사람의 buffered[0]이 이 유령의 닉네임이 되어 엉뚱하게 묶인다 —
          // crash보다 조용히 더 나쁘다. room.leave로 확실히 되돌린다(leave는 trim하므로
          // 원본 문자열을 그대로 넘겨도 안전하다).
          room.leave(raw.nickname);
          sendError('bad-msg', '입장 처리 중 내부 오류가 발생했습니다.');
          socket.end();
          return;
        }
        nickname = canonical;
        hasJoined = true;
        sockets.set(canonical, socket);
        socket.write(encodeMsg({ type: 'joined', you: canonical } satisfies ServerMsg));
        // join() 처리 중 이 소켓 앞으로 왔지만 아직 등록되지 않아 버퍼에 쌓였던 메시지들을
        // (있다면) 도착 순서 그대로 뒤이어 흘려보낸다.
        for (const { msg } of buffered) socket.write(encodeMsg(msg));
      };

      socket.on('data', (chunk: Buffer) => {
        let parsed: unknown[];
        try {
          parsed = decoder.push(chunk);
        } catch {
          // NdjsonDecoder는 계약상 던지지 않지만, 네트워크에서 온 것은 무엇도 신뢰하지 않는다.
          return;
        }
        for (const raw of parsed) {
          if (socket.destroyed) return;
          if (!hasJoined) {
            handleFirstMessage(raw);
          } else {
            // 형태 검증은 room.handleMessage 내부의 경계 검사가 책임진다(퍼징으로 검증됨) —
            // 여기서는 그 앞을 우회하지 않고 그대로 넘긴다. 'join'을 다시 보내거나 알 수 없는
            // type을 보내도 room.handleMessage가 조용히 무시한다.
            room.handleMessage(nickname!, raw as ClientMsg);
          }
        }
      });

      socket.on('close', leaveOnce);
      socket.on('error', leaveOnce);
    });

    let attempt = 0;
    let port = preferredPort;

    const onListenError = (err: NodeJS.ErrnoException): void => {
      // port는 여기서 다음 시도값으로 쓰인다 — 65535(TCP 포트 최댓값)를 넘어서면
      // server.listen(65536)이 ERR_SOCKET_BAD_PORT를 "이 error 핸들러 안에서 동기적으로"
      // 던진다. 이 핸들러는 EventEmitter가 부르는 콜백이라 그 throw는 프로미스 reject가 아닌
      // uncaughtException이 된다 — 그 경계를 넘기 전에 멈추고 원래 EADDRINUSE로 깔끔하게
      // reject한다.
      if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_RETRIES && port < 65535) {
        attempt++;
        port++;
        tryListen();
        return;
      }
      reject(err);
    };

    const tryListen = (): void => {
      server.once('error', onListenError);
      // 호스트를 지정하지 않고 listen하면 Node가 와일드카드 주소(가능하면 IPv6 '::', 아니면
      // IPv4 '0.0.0.0')에 바인딩한다 — 이 게임은 LAN 멀티플레이어이므로 loopback(127.0.0.1)
      // 에만 묶으면 같은 서브넷의 다른 기기는 전부 ECONNREFUSED를 받는다. 루프백 접속(테스트가
      // 쓰는 127.0.0.1 연결 포함)은 와일드카드 바인딩에도 여전히 된다.
      server.listen(port, () => {
        server.removeListener('error', onListenError);
        // 바인딩 이후의 서버 레벨 에러(예: accept 중 EMFILE)로 프로세스가 죽지 않도록 —
        // 이 시점부터는 재시도 대상이 아니다. 그렇다고 조용히 삼키면 운영 중 장애가 아무
        // 흔적도 안 남으므로 최소한 stderr에는 남긴다.
        server.on('error', (err) => {
          console.error('[card-night] TCP 서버 에러:', err);
        });
        const addr = server.address();
        const boundPort = addr && typeof addr === 'object' ? addr.port : port;
        const boundAddress = addr && typeof addr === 'object' ? addr.address : '0.0.0.0';
        resolve(makeRunningServer(boundPort, boundAddress));
      });
    };

    const makeRunningServer = (boundPort: number, boundAddress: string): RunningServer => {
      const timer = setInterval(() => room.checkTimeout(), 1000);
      timer.unref();
      let closed = false;

      return {
        port: boundPort,
        address: boundAddress,
        close(): Promise<void> {
          if (closed) return Promise.resolve();
          closed = true;
          clearInterval(timer);
          return new Promise((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) rejectClose(err);
              else resolveClose();
            });
            for (const sock of [...openSockets]) sock.destroy();
          });
        },
      };
    };

    tryListen();
  });
}

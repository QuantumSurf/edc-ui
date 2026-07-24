// EDC 클라이언트 에러 인터셉터 특성화 — 업스트림 장애가 EdcApiError 로 어떻게
// 매핑되는지 실제 로컬 http 서버로 고정한다. 이 매핑이 깨지면 커넥터 장애가
// 500 으로 뭉개지거나(503 재시도 신호 유실) 내부 메시지가 노출된다.
import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { createEdcClient, EdcApiError } from "./edcClient.js";

const servers: Server[] = [];

/** 핸들러로 1회용 로컬 http 서버를 띄우고 baseURL 을 돌려준다. */
function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  return new Promise(resolve => {
    const srv = createServer(handler);
    servers.push(srv);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterAll(async () => {
  await Promise.all(
    servers.map(s => {
      // 타임아웃 테스트가 남긴 미응답 소켓이 close 콜백을 막는다 → 강제 종료 먼저.
      s.closeAllConnections();
      return new Promise<void>(r => s.close(() => r()));
    })
  );
});

async function expectEdcError(p: Promise<unknown>): Promise<EdcApiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(EdcApiError);
    return err as EdcApiError;
  }
  throw new Error("EdcApiError 가 발생해야 한다");
}

describe("createEdcClient 에러 인터셉터", () => {
  it("EDC 검증오류 배열([{message}...])을 세미콜론 결합 detail 로", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([{ message: "mandatory field" }, { message: "bad id" }])
      );
    });
    const err = await expectEdcError(
      createEdcClient({ managementUrl: base, apiKey: "k" }).get("/x")
    );
    expect(err.status).toBe(400);
    expect(err.detail).toBe("mandatory field; bad id");
    expect(err.fromEdcResponse).toBe(true);
  });

  it("객체 본문의 message 를 detail 로(5xx 도 fromEdcResponse=true)", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "vault alias not found" }));
    });
    const err = await expectEdcError(
      createEdcClient({ managementUrl: base, apiKey: "k" }).get("/x")
    );
    expect(err.status).toBe(500);
    expect(err.detail).toBe("vault alias not found");
    expect(err.fromEdcResponse).toBe(true);
  });

  it("연결 거부(ECONNREFUSED)는 503 'Connector unreachable' — 재시도 신호", async () => {
    // 즉시 닫아 포트만 확보 → 연결 거부 유도(리슨 중 아님).
    const srv = createServer(() => {});
    const port = await new Promise<number>(r =>
      srv.listen(0, "127.0.0.1", () => r((srv.address() as AddressInfo).port))
    );
    await new Promise<void>(r => srv.close(() => r()));
    const err = await expectEdcError(
      createEdcClient({
        managementUrl: `http://127.0.0.1:${port}`,
        apiKey: "k",
      }).get("/x")
    );
    expect(err.status).toBe(503);
    expect(err.detail).toContain("Connector unreachable");
    expect(err.fromEdcResponse).toBe(false);
  });

  it("타임아웃(ECONNABORTED)도 503 'Connector unreachable'", async () => {
    const base = await listen(() => {
      /* 응답하지 않음 → 클라 타임아웃 */
    });
    const err = await expectEdcError(
      createEdcClient({ managementUrl: base, apiKey: "k", timeoutMs: 200 }).get(
        "/slow"
      )
    );
    expect(err.status).toBe(503);
    expect(err.fromEdcResponse).toBe(false);
  });

  it("X-Api-Key 헤더를 요청에 싣는다(커넥터 인증)", async () => {
    let seen = "";
    const base = await listen((req, res) => {
      seen = String(req.headers["x-api-key"] ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await createEdcClient({ managementUrl: base, apiKey: "sekret" }).get("/x");
    expect(seen).toBe("sekret");
  });

  it("30x 리다이렉트를 따라가지 않는다(SSRF — X-Api-Key 유출 차단)", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/meta" });
      res.end();
    });
    const err = await expectEdcError(
      createEdcClient({ managementUrl: base, apiKey: "k" }).get("/x")
    );
    // 리다이렉트 미추적 → 302 가 그대로 에러로 떨어진다(내부 주소로 재요청 없음).
    expect(err.status).not.toBe(200);
  });
});

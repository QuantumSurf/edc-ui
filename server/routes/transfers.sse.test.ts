// SSE 진행률 스트림 계약·누수 테스트 — k6 가 못 잡는 "장수명 SSE" 회귀를 잡는다.
// event-stream 프레이밍·스냅샷 전달·완료 시 종료·disconnect 시 구독 정리(누수 0)를 검증한다.
// getSnapshot(인메모리)로 로컬 잡 경로를 타므로 DB/인증 불필요(라우터 bare 마운트).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import transfersRouter from "./transfers.js";
import {
  startBulkTransfer,
  cancelBulkTransfer,
  subscriberCount,
  type Uploader,
} from "../lib/transferWorker.js";

// finish() 호출 전까지 대기하는 업로더(잡을 RUNNING 유지, 완료 시점 제어).
function controllableUploader(): { u: Uploader; finish: () => void } {
  let resolve: (() => void) | null = null;
  const u: Uploader = {
    upload(_k, _b, _on, signal) {
      return new Promise<void>((res, rej) => {
        resolve = res;
        if (signal.aborted) rej(new Error("aborted"));
        signal.addEventListener("abort", () => rej(new Error("aborted")), {
          once: true,
        });
      });
    },
  };
  return { u, finish: () => resolve?.() };
}

const emptyFile = {
  name: "a",
  size: 100,
  open: async () => Readable.from(Buffer.alloc(0)),
};

const app = express();
app.use(express.json());
app.use("/api/connectors", transfersRouter);
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  cancelBulkTransfer("sse", "j1");
  cancelBulkTransfer("sse", "j2");
  await new Promise<void>(r => server.close(() => r()));
});

describe("SSE /progress/stream 계약·누수", () => {
  it("스냅샷 이벤트 전달 + disconnect 시 구독 정리(누수 0)", async () => {
    const ctrl = controllableUploader();
    startBulkTransfer({
      connectorId: "sse",
      transferId: "j1",
      files: [emptyFile],
      uploader: ctrl.u,
    });

    const { req, firstData } = await new Promise<{
      req: http.ClientRequest;
      firstData: string;
    }>((resolve, reject) => {
      const r = http.get(
        `${baseUrl}/api/connectors/sse/transfers/j1/progress/stream`,
        res => {
          expect(res.headers["content-type"]).toContain("text/event-stream");
          let buf = "";
          res.on("data", (c: Buffer) => {
            buf += c.toString();
            const line = buf.split("\n").find(l => l.startsWith("data:"));
            if (line) resolve({ req: r, firstData: line });
          });
          res.on("error", reject);
        }
      );
      r.on("error", reject);
    });

    const snap = JSON.parse(firstData.slice(5).trim());
    expect(snap.transferId).toBe("j1");
    expect(subscriberCount("sse", "j1")).toBeGreaterThan(0);

    // 클라이언트 disconnect → 서버 req 'close' → 구독 해제.
    req.destroy();
    await new Promise(r => setTimeout(r, 150));
    expect(subscriberCount("sse", "j1")).toBe(0);
  }, 20_000);

  it("완료 시 종료 스냅샷 후 스트림 종료(res.end)", async () => {
    const ctrl = controllableUploader();
    startBulkTransfer({
      connectorId: "sse",
      transferId: "j2",
      files: [emptyFile],
      uploader: ctrl.u,
    });

    const body = await new Promise<string>((resolve, reject) => {
      const r = http.get(
        `${baseUrl}/api/connectors/sse/transfers/j2/progress/stream`,
        res => {
          let buf = "";
          res.on("data", (c: Buffer) => (buf += c.toString()));
          res.on("end", () => resolve(buf));
          res.on("error", reject);
        }
      );
      r.on("error", reject);
      setTimeout(() => ctrl.finish(), 150); // 업로드 완료 → 워커 COMPLETED → SSE 종료
    });

    expect(body).toContain("data:");
    const events = body
      .split("\n\n")
      .map(e => e.split("\n").find(l => l.startsWith("data:")))
      .filter((l): l is string => Boolean(l));
    const last = JSON.parse(events[events.length - 1].slice(5).trim());
    expect(last.state).toBe("COMPLETED");
    expect(subscriberCount("sse", "j2")).toBe(0);
  }, 20_000);
});

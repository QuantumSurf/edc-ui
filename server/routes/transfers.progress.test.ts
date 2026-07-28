// 대량전송 진행 조회 라우트 와이어링(경량) — GET /progress 가 워커 인메모리 스냅샷을
// 매핑하는지 확인한다. writeGuard 가 걸린 cancel/bulk-transfer 와 SSE 실동작·DB 폴백은
// 인증/DB(testcontainers)·MinIO 가 필요해 P6 dev 실측/통합에서 검증한다.
import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
import transfersRouter from "./transfers.js";
import {
  startBulkTransfer,
  cancelBulkTransfer,
  type Uploader,
} from "../lib/transferWorker.js";

// abort 전까지 대기하는 업로더(잡을 RUNNING 으로 유지).
const hangingUploader: Uploader = {
  upload(_k, _b, _on, signal) {
    return new Promise<void>((_res, rej) => {
      if (signal.aborted) return rej(new Error("aborted"));
      signal.addEventListener("abort", () => rej(new Error("aborted")), {
        once: true,
      });
    });
  },
};

const app = express();
app.use(express.json());
app.use("/api/connectors", transfersRouter);

afterAll(() => {
  cancelBulkTransfer("c1", "tp1");
});

describe("GET /:id/transfers/:tpId/progress", () => {
  it("워커 인메모리 스냅샷을 반환한다", async () => {
    startBulkTransfer({
      connectorId: "c1",
      transferId: "tp1",
      files: [
        {
          name: "a",
          size: 1000,
          open: async () => Readable.from(Buffer.alloc(0)),
        },
        {
          name: "b",
          size: 2000,
          open: async () => Readable.from(Buffer.alloc(0)),
        },
      ],
      uploader: hangingUploader,
    });
    const res = await request(app).get(
      "/api/connectors/c1/transfers/tp1/progress"
    );
    expect(res.status).toBe(200);
    expect(res.body.transferId).toBe("tp1");
    expect(res.body.connectorId).toBe("c1");
    expect(res.body.fileCount).toBe(2);
    expect(res.body.totalBytes).toBe(3000);
    expect(["PENDING", "RUNNING"]).toContain(res.body.state);
  });
});

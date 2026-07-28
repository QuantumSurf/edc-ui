import { describe, it, expect } from "vitest";
import { register, bulkTransfersTotal } from "./metrics.js";

describe("대량전송 메트릭", () => {
  it("4개 지표가 /metrics 레지스트리에 등록된다", async () => {
    const text = await register.metrics();
    expect(text).toContain("bulk_transfer_active_jobs");
    expect(text).toContain("bulk_transfer_sse_connections");
    expect(text).toContain("bulk_transfer_bytes_total");
    expect(text).toContain("bulk_transfer_total");
  });

  it("상태별 종료 카운터가 증가한다", async () => {
    bulkTransfersTotal.inc({ state: "completed" });
    const text = await register.metrics();
    expect(text).toMatch(/bulk_transfer_total\{state="completed"\} [1-9]/);
  });
});

// KMX EDC — 배포 표면(exposure) 단위테스트
//
// 프로덕션 배포에서만 발현되는 노출 결함을 잡는다. dev(vite 미들웨어·인그레스 없음)에서는
// 드러나지 않아 통합테스트로도 놓치기 쉬운 영역이다.
//  · /metrics 는 무인증인데 인그레스 path 가 "/" Prefix 라 인터넷에 그대로 노출된다
//    → 인그레스 경유(X-Forwarded-*) 요청은 404 로 막고, 파드 IP 직접 스크레이프만 허용한다.
// DB 를 건드리지 않는 경로만 검증하므로 Docker 없이 돈다.

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { buildApp } from "./app.js";

afterEach(() => {
  delete process.env.METRICS_ALLOW_FORWARDED;
});

describe("/metrics 노출 표면", () => {
  it("파드 IP 직접 스크레이프(프록시 헤더 없음)는 메트릭을 반환한다", async () => {
    const res = await request(buildApp()).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("bulk_transfer_active_jobs");
  });

  it("인그레스 경유(X-Forwarded-For) 요청은 404 로 막는다", async () => {
    const res = await request(buildApp())
      .get("/metrics")
      .set("X-Forwarded-For", "203.0.113.7");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("bulk_transfer_active_jobs");
  });

  it("X-Forwarded-Proto/Host 만 있어도 막는다(프록시 구현 차이 대응)", async () => {
    const byProto = await request(buildApp())
      .get("/metrics")
      .set("X-Forwarded-Proto", "https");
    expect(byProto.status).toBe(404);

    const byHost = await request(buildApp())
      .get("/metrics")
      .set("X-Forwarded-Host", "edc-ui.kmx.io");
    expect(byHost.status).toBe(404);
  });

  it("METRICS_ALLOW_FORWARDED=true 면 프록시 경유 스크레이프를 허용한다", async () => {
    process.env.METRICS_ALLOW_FORWARDED = "true";
    const res = await request(buildApp())
      .get("/metrics")
      .set("X-Forwarded-For", "203.0.113.7");
    expect(res.status).toBe(200);
    expect(res.text).toContain("bulk_transfer_active_jobs");
  });

  it("liveness 프로브는 프록시 헤더와 무관하게 동작한다", async () => {
    const res = await request(buildApp())
      .get("/healthz")
      .set("X-Forwarded-For", "203.0.113.7");
    expect(res.status).toBe(200);
  });
});

describe("미매칭 /api 경로", () => {
  it("SPA 폴백 HTML 이 아니라 JSON 으로 응답한다", async () => {
    // 미인증이면 authMiddleware 가 먼저 401 을 준다 — 어느 쪽이든 HTML(200)이면 안 된다.
    const res = await request(buildApp()).get("/api/definitely-not-a-route");
    expect(res.status).not.toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

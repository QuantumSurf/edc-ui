// KMX EDC — 스키마 버전 게이트(/readyz) 회귀테스트
//
// 롤링 배포 순단 방지 계약을 코드로 고정한다. 동등 비교(===)로 되돌아가면 스키마 버전을
// 올리는 릴리스마다 구 파드가 전부 동시에 503 으로 빠져 서빙 파드가 0 이 되는 창이 생긴다.
// (새 파드가 마이그레이션을 끝내는 순간 → 새 파드가 Ready 가 되기 전까지. 새 버전이 기동에
//  실패하면 무기한.) 하한선 비교 + expand/contract 규약이 그 창을 없앤다.

import { describe, it, expect } from "vitest";
import { isSchemaVersionSatisfied, SCHEMA_VERSION } from "./db.js";

describe("스키마 버전 게이트", () => {
  it("DB 가 내 요구 버전과 같으면 Ready", () => {
    expect(isSchemaVersionSatisfied("2026-07-02", "2026-07-02")).toBe(true);
  });

  it("★ DB 가 나보다 새것이어도 Ready — 롤링 중 구 파드가 죽지 않아야 한다", () => {
    // 새 파드가 먼저 떠서 DB 를 2026-09-01 로 올린 상황의 구 파드.
    expect(isSchemaVersionSatisfied("2026-09-01", "2026-07-02")).toBe(true);
  });

  it("DB 가 내 요구 버전보다 낮으면 NotReady — 마이그레이션 전 파드는 트래픽에서 뺀다", () => {
    expect(isSchemaVersionSatisfied("2026-07-02", "2026-09-01")).toBe(false);
  });

  it("연/월/일 자릿수 경계에서도 시간순으로 비교한다", () => {
    expect(isSchemaVersionSatisfied("2026-10-01", "2026-09-30")).toBe(true);
    expect(isSchemaVersionSatisfied("2026-09-30", "2026-10-01")).toBe(false);
    expect(isSchemaVersionSatisfied("2027-01-01", "2026-12-31")).toBe(true);
    expect(isSchemaVersionSatisfied("2026-12-31", "2027-01-01")).toBe(false);
  });

  it("값이 없거나 형식이 깨졌으면 fail-closed", () => {
    expect(isSchemaVersionSatisfied(undefined)).toBe(false);
    expect(isSchemaVersionSatisfied(null)).toBe(false);
    expect(isSchemaVersionSatisfied("")).toBe(false);
    expect(isSchemaVersionSatisfied("v2")).toBe(false);
    expect(isSchemaVersionSatisfied("2026-7-2")).toBe(false); // 제로패딩 아님 → 사전순 비교 불가
    expect(isSchemaVersionSatisfied("2026-07-02", "not-a-date")).toBe(false);
  });

  it("SCHEMA_VERSION 상수 자체가 YYYY-MM-DD 규약을 지킨다", () => {
    // 이 형식이 깨지면 사전순 비교가 시간순 비교가 아니게 되어 게이트가 조용히 오작동한다.
    expect(SCHEMA_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isSchemaVersionSatisfied(SCHEMA_VERSION)).toBe(true);
  });
});

// resolveS3Target — 자격/endpoint all-or-nothing 정책 회귀 잠금.
// (사용자 endpoint + 콘솔 env 자격 혼합 = SSRF/자격 오배송을 코드로 차단하는지 검증.)
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveS3Target, isS3TargetUsable } from "./s3.js";

const ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
] as const;

describe("resolveS3Target — 자격/endpoint all-or-nothing", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("dataSink 가 자격을 완전히 주면 그대로 사용(env 미참조)", () => {
    process.env.S3_ACCESS_KEY_ID = "ENV_SHOULD_NOT_LEAK";
    process.env.S3_SECRET_ACCESS_KEY = "ENV_SECRET";
    const t = resolveS3Target({
      bucketName: "b",
      endpointOverride: "http://minio:9000",
      accessKeyId: "user-ak",
      secretAccessKey: "user-sk",
    });
    expect(t.endpoint).toBe("http://minio:9000");
    expect(t.accessKeyId).toBe("user-ak");
    expect(t.secretAccessKey).toBe("user-sk");
    expect(isS3TargetUsable(t)).toBe(true);
  });

  it("dataSink 가 endpoint 만 주면 env 자격을 끌어오지 않는다(혼합 차단→미사용)", () => {
    process.env.S3_ACCESS_KEY_ID = "ENV_AK";
    process.env.S3_SECRET_ACCESS_KEY = "ENV_SK";
    const t = resolveS3Target({
      bucketName: "b",
      endpointOverride: "http://attacker.example",
    });
    // 사용자 endpoint + env 자격 혼합 금지 → 자격이 비어 사용 불가로 400 유도.
    expect(t.accessKeyId).toBeUndefined();
    expect(t.secretAccessKey).toBeUndefined();
    expect(isS3TargetUsable(t)).toBe(false);
  });

  it("dataSink 가 비면 env 로 전부 폴백", () => {
    process.env.S3_ENDPOINT = "http://minio:9000";
    process.env.S3_ACCESS_KEY_ID = "ENV_AK";
    process.env.S3_SECRET_ACCESS_KEY = "ENV_SK";
    process.env.S3_BUCKET = "envbucket";
    const t = resolveS3Target({});
    expect(t.endpoint).toBe("http://minio:9000");
    expect(t.accessKeyId).toBe("ENV_AK");
    expect(t.secretAccessKey).toBe("ENV_SK");
    expect(t.bucket).toBe("envbucket");
    expect(isS3TargetUsable(t)).toBe(true);
  });

  it("dataSink 자격만 주고 endpoint 없으면 env endpoint 도 안 끌어온다(all-or-nothing)", () => {
    process.env.S3_ENDPOINT = "http://minio:9000";
    const t = resolveS3Target({
      bucketName: "b",
      accessKeyId: "user-ak",
      secretAccessKey: "user-sk",
    });
    // 사용자가 자격을 준 순간 endpoint 도 dataSink 전용 → 미지정이면 undefined(실 AWS 향함).
    expect(t.endpoint).toBeUndefined();
    expect(t.accessKeyId).toBe("user-ak");
  });
});

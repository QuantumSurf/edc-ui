import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "./crypto.js";

// 커넥터 EDC API Key at-rest 암호화(AES-256-GCM)의 보안 불변식 회귀 테스트.
describe("crypto (at-rest AES-256-GCM)", () => {
  it("encrypt → decrypt 왕복이 원문을 복원하고, 암호문에 평문이 노출되지 않는다", () => {
    const plain = "super-secret-api-key-123";
    const enc = encryptSecret(plain);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("빈 문자열은 암호화하지 않고 그대로 둔다", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("레거시 평문(enc: 접두 없음)은 그대로 반환한다(이행기 호환)", () => {
    expect(decryptSecret("plain-legacy-key")).toBe("plain-legacy-key");
  });

  it("변조된(GCM auth tag 불일치) 암호문은 throw 하지 않고 빈 값을 반환한다", () => {
    // batch2 회귀 방지 — 키 회전/백업 불일치로 복호화가 throw 하면 커넥터 목록 전체가 500 이 된다.
    const enc = encryptSecret("secret-value");
    const last = enc.slice(-1);
    const tampered = enc.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(() => decryptSecret(tampered)).not.toThrow();
    expect(decryptSecret(tampered)).toBe("");
  });

  it("encryptSecret 은 멱등이다(이미 암호문이면 그대로)", () => {
    const enc = encryptSecret("x");
    expect(encryptSecret(enc)).toBe(enc);
  });
});

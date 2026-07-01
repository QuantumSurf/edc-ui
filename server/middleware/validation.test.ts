import { describe, it, expect, afterEach } from "vitest";
import { validateDspEndpoint } from "./validation.js";

// SSRF 방어(호스트 문자열 기반)의 회귀 테스트. null=허용, 문자열=거부 사유.
describe("validateDspEndpoint (SSRF)", () => {
  const prev = process.env.ALLOW_PRIVATE_DSP;
  afterEach(() => {
    if (prev === undefined) delete process.env.ALLOW_PRIVATE_DSP;
    else process.env.ALLOW_PRIVATE_DSP = prev;
  });

  it("공인 HTTPS 엔드포인트는 허용한다(null)", () => {
    delete process.env.ALLOW_PRIVATE_DSP;
    expect(
      validateDspEndpoint("https://provider.example.com/api/dsp")
    ).toBeNull();
  });

  it("http/https 외 프로토콜은 거부한다", () => {
    delete process.env.ALLOW_PRIVATE_DSP;
    expect(validateDspEndpoint("file:///etc/passwd")).not.toBeNull();
    expect(validateDspEndpoint("ftp://x/")).not.toBeNull();
  });

  it("사설/loopback/클라우드 메타데이터 주소는 거부한다", () => {
    delete process.env.ALLOW_PRIVATE_DSP;
    for (const u of [
      "http://127.0.0.1/",
      "http://localhost/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
    ]) {
      expect(validateDspEndpoint(u), u).not.toBeNull();
    }
  });

  it("decimal/hex 인코딩 IP 우회도 거부한다", () => {
    delete process.env.ALLOW_PRIVATE_DSP;
    expect(validateDspEndpoint("http://2130706433/")).not.toBeNull(); // 127.0.0.1
    expect(validateDspEndpoint("http://0x7f000001/")).not.toBeNull();
  });

  it("잘못된 URL 은 거부한다", () => {
    delete process.env.ALLOW_PRIVATE_DSP;
    expect(validateDspEndpoint("not a url")).not.toBeNull();
  });

  it("정상 도메인(fc/fd 접두)은 IPv6 ULA 로 오탐 차단하지 않는다(id 66)", () => {
    delete process.env.ALLOW_PRIVATE_DSP;
    expect(validateDspEndpoint("https://fdtest.io/")).toBeNull();
    expect(validateDspEndpoint("https://fc.example.com/")).toBeNull();
  });

  it("ALLOW_PRIVATE_DSP=true 면 dev 편의로 사설 IP 를 허용한다", () => {
    process.env.ALLOW_PRIVATE_DSP = "true";
    expect(validateDspEndpoint("http://127.0.0.1/")).toBeNull();
  });
});

// KMX EDC — Request validation + SSRF protection
import type { Request, Response, NextFunction } from "express";
import { lookup } from "node:dns/promises";

/**
 * Validate that a URL is valid and not targeting dangerous networks (SSRF protection).
 * Dev override: ALLOW_PRIVATE_DSP=true 일 때 사설/loopback IP 허용 (로컬 통합 테스트용).
 * Docker container hostname (예: kmx-provider-controlplane)은 DNS 이름이므로 IP 체크와 무관하게 통과.
 *
 * [배포 결정 필요/한계 — id 65] 이 검증은 호스트명 '문자열'만 검사한다. 따라서 DNS 리바인딩
 * (공격자가 공인 도메인을 사설 IP로 응답)이나 내부 호스트명 화이트리스트 우회는 막지 못한다.
 * 근본 차단은 호스트명을 IP로 해석해 사설/메타데이터 대역을 차단하고 그 IP로 고정(pin)하는
 * 방식이 필요하다(예: 운영에서 신뢰 호스트 allowlist 필수화). prod 게이팅은 운영 정책 결정 사안.
 */
export function validateDspEndpoint(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return "Only HTTP/HTTPS endpoints are allowed";

    if (process.env.ALLOW_PRIVATE_DSP === "true") return null;

    const hostname = parsed.hostname.toLowerCase();
    const h6 = hostname.replace(/^\[|\]$/g, ""); // IPv6 리터럴 브래킷 제거 후 비교
    // IPv6 리터럴 여부 — ':'를 포함해야 IPv6 주소다. fc/fd/fe 접두 검사는 IPv6 리터럴에만
    // 적용해야 정상 도메인(fc.example.com, fdtest.io 등)을 오탐 차단하지 않는다(id 66).
    const isIpv6Literal = h6.includes(":");
    // Block private IP ranges, localhost, link-local, AWS/GCP/Azure metadata,
    // IPv6 loopback/unspecified/ULA/link-local/IPv4-mapped, and decimal/hex IP encodings.
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("169.254.") || // includes 169.254.169.254 cloud metadata
      /^0x[0-9a-f]+$/i.test(hostname) || // hex-encoded IP (e.g. 0x7f000001)
      /^\d+$/.test(hostname) || // decimal integer IP (e.g. 2130706433 = 127.0.0.1)
      h6 === "::1" ||
      h6 === "::" || // IPv6 loopback / unspecified
      (isIpv6Literal &&
        (/^fc/.test(h6) || // IPv6 ULA fc00::/7
          /^fd/.test(h6) ||
          /^fe[89ab]/.test(h6) || // IPv6 link-local fe80::/10
          h6.startsWith("::ffff:"))) // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    ) {
      return "Private/internal network addresses are not allowed";
    }
    return null; // valid
  } catch {
    return "Invalid URL format";
  }
}

/** 해석된 IP(문자열)가 사설/루프백/링크로컬/메타데이터 대역인지. IPv4-mapped IPv6 포함. */
function isBlockedIp(ip: string): boolean {
  const addr = ip.toLowerCase();
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped
    ? mapped[1]
    : /^\d+\.\d+\.\d+\.\d+$/.test(addr)
      ? addr
      : null;
  if (v4) {
    return (
      v4.startsWith("127.") ||
      v4.startsWith("10.") ||
      v4.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
      v4.startsWith("169.254.") || // link-local + 169.254.169.254 cloud metadata
      v4.startsWith("0.") ||
      v4 === "0.0.0.0"
    );
  }
  return (
    addr === "::1" ||
    addr === "::" ||
    /^fc/.test(addr) || // ULA fc00::/7
    /^fd/.test(addr) ||
    /^fe[89ab]/.test(addr) // link-local fe80::/10
  );
}

/**
 * SSRF 근본 강화(위 id 65 한계 보완): 문자열 검사(validateDspEndpoint)에 더해 호스트명을 실제
 * DNS 해석하여, 사설/메타데이터 대역으로 해석되면 거부한다. 이로써 "공인 도메인 A레코드를
 * 169.254.169.254 등 내부 IP로 응답"하는 DNS 리바인딩/내부 호스트명 우회를 차단한다.
 *
 * dev/docker 통합(ALLOW_PRIVATE_DSP=true)에서는 컨테이너 사설 DNS 이름을 그대로 통과시킨다
 * (기존 문자열 검사 동작 유지). 해석 실패는 '검증 불가'로 보고 거부한다.
 *
 * [잔여 한계] 해석 시점과 실제 요청(axios 재해석) 사이의 TOCTOU(sub-TTL 리바인딩)까지는 막지
 * 못한다 — 완전 차단은 해석 IP 고정(pin) 또는 신뢰 호스트 allowlist가 필요(운영 정책 결정).
 */
export async function assertEndpointPublic(
  url: string
): Promise<string | null> {
  const syncErr = validateDspEndpoint(url);
  if (syncErr) return syncErr;
  if (process.env.ALLOW_PRIVATE_DSP === "true") return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "Invalid URL format";
  }
  try {
    const addrs = await lookup(hostname, { all: true });
    if (addrs.some(a => isBlockedIp(a.address))) {
      return "Private/internal network addresses are not allowed (resolved)";
    }
  } catch {
    return "Endpoint host could not be resolved";
  }
  return null;
}

/** Validate connector ID format (alphanumeric + hyphens) */
export function validateConnectorId(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const id = req.params.id;
  if (id && !/^[a-zA-Z0-9\-_]+$/.test(id)) {
    res.status(400).json({ error: "Invalid connector ID format" });
    return;
  }
  next();
}

/** Validate resource ID format */
export function validateResourceId(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.params[paramName];
    if (id && !/^[a-zA-Z0-9\-_:.]+$/.test(id)) {
      res.status(400).json({ error: `Invalid ${paramName} format` });
      return;
    }
    next();
  };
}

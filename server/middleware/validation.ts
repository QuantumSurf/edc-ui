// KMX EDC — Request validation + SSRF protection
import type { Request, Response, NextFunction } from "express";

/**
 * Validate that a URL is valid and not targeting dangerous networks (SSRF protection).
 * Dev override: ALLOW_PRIVATE_DSP=true 일 때 사설/loopback IP 허용 (로컬 통합 테스트용).
 * Docker container hostname (예: kmx-provider-controlplane)은 DNS 이름이므로 IP 체크와 무관하게 통과.
 */
export function validateDspEndpoint(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "Only HTTP/HTTPS endpoints are allowed";

    if (process.env.ALLOW_PRIVATE_DSP === "true") return null;

    const hostname = parsed.hostname;
    // Block private IP ranges, localhost, link-local, AWS/GCP metadata
    if (
      hostname === "localhost" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("169.254.") || // includes AWS/GCP/Azure metadata 169.254.169.254
      hostname === "[::1]" ||
      hostname === "::1"
    ) {
      return "Private/internal network addresses are not allowed";
    }
    return null; // valid
  } catch {
    return "Invalid URL format";
  }
}

/** Validate connector ID format (alphanumeric + hyphens) */
export function validateConnectorId(req: Request, res: Response, next: NextFunction) {
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

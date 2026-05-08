// KMX EDC — Express error handling middleware
// Sanitizes error messages to prevent information disclosure
import type { Request, Response, NextFunction } from "express";
import { EdcApiError } from "../lib/edcClient.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function sanitizeMessage(message: string): string {
  if (IS_PRODUCTION) {
    // In production, never expose internal details
    if (message.includes("ECONNREFUSED") || message.includes("ECONNABORTED")) {
      return "Service temporarily unavailable";
    }
    if (message.includes("timeout")) {
      return "Request timed out";
    }
    return "An error occurred";
  }
  return message; // In development, show full error for debugging
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof EdcApiError) {
    console.error(`[BFF] EDC API Error: ${err.status} ${err.detail}`);
    // 4xx client errors contain user-actionable validation info — pass through
    const message = err.status >= 400 && err.status < 500
      ? err.detail
      : sanitizeMessage(err.detail);
    res.status(err.status).json({ error: message, source: "edc" });
    return;
  }

  if (err instanceof Error) {
    console.error("[BFF] Error:", err.message);
    res.status(500).json({ error: sanitizeMessage(err.message) });
    return;
  }

  res.status(500).json({ error: "Unknown error" });
}

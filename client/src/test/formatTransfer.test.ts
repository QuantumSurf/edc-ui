import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatSpeed,
  etaParts,
  percent,
} from "../lib/formatTransfer.js";

describe("formatBytes", () => {
  it("단위 스케일", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1.46 * 1024 ** 3)).toBe("1.46 GB");
    expect(formatBytes(150 * 1024 ** 2)).toBe("150 MB"); // >=100 → 0자리
  });
  it("미상/음수 → —", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Infinity)).toBe("—");
  });
});

describe("formatSpeed", () => {
  it("B/s 포맷", () => {
    expect(formatSpeed(1.31 * 1024 ** 2)).toBe("1.31 MB/s");
  });
  it("0 이하/미상 → —", () => {
    expect(formatSpeed(0)).toBe("—");
    expect(formatSpeed(null)).toBe("—");
  });
});

describe("etaParts", () => {
  it("초 → h/m/s 분해", () => {
    expect(etaParts(209)).toEqual({ h: 0, m: 3, s: 29 }); // 3분 29초
    expect(etaParts(3665)).toEqual({ h: 1, m: 1, s: 5 });
    expect(etaParts(0)).toEqual({ h: 0, m: 0, s: 0 });
  });
  it("미상/음수 → null", () => {
    expect(etaParts(null)).toBeNull();
    expect(etaParts(-5)).toBeNull();
  });
});

describe("percent", () => {
  it("비율 계산·클램프", () => {
    expect(percent(500, 1000)).toBe(50);
    expect(percent(1500, 1000)).toBe(100);
    expect(percent(-10, 1000)).toBe(0);
  });
  it("총량 미상 → null", () => {
    expect(percent(500, null)).toBeNull();
    expect(percent(500, 0)).toBeNull();
  });
});

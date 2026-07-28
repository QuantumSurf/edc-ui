import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { chunkFrom } from "./resumableUploader.js";

async function sizes(gen: AsyncGenerator<Buffer>): Promise<number[]> {
  const out: number[] = [];
  for await (const c of gen) out.push(c.length);
  return out;
}

function src(...chunkLens: number[]): Readable {
  return Readable.from(chunkLens.map(n => Buffer.alloc(n, 1)));
}

describe("chunkFrom — skip + partSize 청킹(한 패스)", () => {
  it("skip 없음: partSize 배수 + 잔여", async () => {
    expect(await sizes(chunkFrom(src(3, 3, 4), 4, 0))).toEqual([4, 4, 2]);
  });
  it("skip 이 청크 경계와 일치", async () => {
    expect(await sizes(chunkFrom(src(3, 3, 4), 4, 3))).toEqual([4, 3]);
  });
  it("skip 이 청크 중간을 가름(부분 청크 손실 없음)", async () => {
    // 총 10, skip 5 → 남은 5 → [4,1]
    expect(await sizes(chunkFrom(src(3, 3, 4), 4, 5))).toEqual([4, 1]);
  });
  it("skip >= 총량 → 아무것도 안 나옴", async () => {
    expect(await sizes(chunkFrom(src(4, 4, 2), 4, 10))).toEqual([]);
  });

  it("바이트 무결성: skip 후 이어붙이면 원본의 나머지와 동일", async () => {
    const original = Buffer.from(Array.from({ length: 20 }, (_, i) => i));
    // 3+7+10 바이트 청크로 쪼갠 소스
    const stream = Readable.from([
      original.subarray(0, 3),
      original.subarray(3, 10),
      original.subarray(10, 20),
    ]);
    const parts: Buffer[] = [];
    for await (const c of chunkFrom(stream, 4, 5)) parts.push(c);
    expect(Buffer.concat(parts)).toEqual(original.subarray(5));
    // 파트 크기: 남은 15 → [4,4,4,3]
    expect(parts.map(p => p.length)).toEqual([4, 4, 4, 3]);
  });
});

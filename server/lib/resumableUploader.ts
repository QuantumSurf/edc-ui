// KMX EDC — 재개 가능 S3 멀티파트 업로더
//
// lib-storage 의 Upload 는 한 프로세스 안에서만 멀티파트를 관리해 재기동 후 재개가 불가능하다.
// 여기서는 CreateMultipartUpload/UploadPart/Complete/Abort 를 직접 다뤄, 각 파트 완료 시 상태를
// 영속한다. 크래시/재기동 후에는 저장된 uploadId 로 ListParts(=S3 를 authoritative)로 완료 파트를
// 재조정하고, 이미 올린 바이트만큼 소스를 건너뛴 뒤 남은 파트만 이어 올린다.
//
// 취소(signal abort)는 사용자 의도이므로 AbortMultipartUpload + 상태 삭제로 정리한다(재개 안 함).
// 크래시는 프로세스가 죽어 이 경로를 안 타므로 상태가 남아 재개된다.

import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { getPool } from "./db.js";
import { makeS3Client, type S3Target } from "./s3.js";
import type { Uploader } from "./transferWorker.js";

const PART_SIZE = 8 * 1024 * 1024; // S3 최소 파트 5MB 이상

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
  Size: number;
}

export interface MultipartState {
  uploadId: string;
  partSize: number;
  parts: CompletedPart[];
}

/** 객체별 멀티파트 상태 저장소(재개용). transfer/connector 스코프에 바인딩된다. */
export interface MultipartStateStore {
  load(key: string): Promise<MultipartState | null>;
  save(key: string, state: MultipartState): Promise<void>;
  clear(key: string): Promise<void>;
}

/** DB(transfer_multipart) 기반 상태 저장소. */
export function createDbMultipartStore(
  connectorId: string,
  transferId: string
): MultipartStateStore {
  return {
    async load(key) {
      const { rows } = await getPool().query(
        `SELECT upload_id, part_size, parts FROM transfer_multipart
          WHERE transfer_id=$1 AND connector_id=$2 AND object_key=$3 AND completed=false`,
        [transferId, connectorId, key]
      );
      const r = rows[0];
      if (!r) return null;
      return {
        uploadId: r.upload_id,
        partSize: Number(r.part_size),
        parts: (r.parts ?? []) as CompletedPart[],
      };
    },
    async save(key, state) {
      await getPool().query(
        `INSERT INTO transfer_multipart
           (transfer_id, connector_id, object_key, upload_id, part_size, parts, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (transfer_id, connector_id, object_key) DO UPDATE
           SET upload_id=EXCLUDED.upload_id, part_size=EXCLUDED.part_size,
               parts=EXCLUDED.parts, updated_at=NOW()`,
        [
          transferId,
          connectorId,
          key,
          state.uploadId,
          state.partSize,
          JSON.stringify(state.parts),
        ]
      );
    },
    async clear(key) {
      await getPool().query(
        `DELETE FROM transfer_multipart
          WHERE transfer_id=$1 AND connector_id=$2 AND object_key=$3`,
        [transferId, connectorId, key]
      );
    },
  };
}

/**
 * 소스 스트림에서 앞 skip 바이트를 버리고, 이후를 partSize 크기 청크로 내보낸다(마지막은 잔여).
 * skip 과 청킹을 한 패스로 처리해 부분 청크 손실을 막는다. export=단위테스트용.
 */
export async function* chunkFrom(
  src: Readable,
  partSize: number,
  skip: number,
  signal?: AbortSignal
): AsyncGenerator<Buffer> {
  let toSkip = Math.max(0, skip);
  let acc: Buffer[] = [];
  let accLen = 0;
  for await (const raw of src as AsyncIterable<Buffer>) {
    if (signal?.aborted) throw new Error("aborted");
    let c: Buffer = raw;
    if (toSkip > 0) {
      if (c.length <= toSkip) {
        toSkip -= c.length;
        continue;
      }
      c = c.subarray(toSkip);
      toSkip = 0;
    }
    acc.push(c);
    accLen += c.length;
    while (accLen >= partSize) {
      const buf = Buffer.concat(acc, accLen);
      yield buf.subarray(0, partSize);
      const rest = buf.subarray(partSize);
      acc = rest.length ? [Buffer.from(rest)] : [];
      accLen = rest.length;
    }
  }
  if (accLen > 0) yield Buffer.concat(acc, accLen);
}

async function listCompletedParts(
  client: ReturnType<typeof makeS3Client>,
  bucket: string,
  key: string,
  uploadId: string
): Promise<CompletedPart[]> {
  const parts: CompletedPart[] = [];
  let marker: string | undefined;
  do {
    const res = await client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      })
    );
    for (const p of res.Parts ?? []) {
      if (p.PartNumber != null)
        parts.push({
          PartNumber: p.PartNumber,
          ETag: p.ETag ?? "",
          Size: p.Size ?? 0,
        });
    }
    marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
  } while (marker);
  parts.sort((a, b) => a.PartNumber - b.PartNumber);
  return parts;
}

/** 재개 가능 S3/MinIO 업로더. store 에 파트 상태를 영속하며, 재기동 후 ListParts 로 이어 올린다. */
export function createResumableS3Uploader(
  target: S3Target,
  store: MultipartStateStore
): Uploader {
  const client = makeS3Client(target);
  const bucket = target.bucket;

  return {
    async upload(key, body, onBytes, signal) {
      let uploadId: string;
      let parts: CompletedPart[];
      const st = await store.load(key);
      const partSize = st?.partSize ?? PART_SIZE;

      if (st) {
        try {
          // S3 를 authoritative 로 — 크래시-후-미영속 파트까지 반영.
          parts = await listCompletedParts(client, bucket, key, st.uploadId);
          uploadId = st.uploadId;
        } catch (err) {
          // 멀티파트가 없다(이미 Complete 됐거나 만료) → 객체가 있으면 완료 처리.
          const name = (err as { name?: string })?.name ?? "";
          if (name === "NoSuchUpload") {
            const head = await client
              .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
              .catch(() => null);
            if (head) {
              await store.clear(key);
              onBytes(head.ContentLength ?? 0);
              return;
            }
          }
          await store.clear(key); // 상태 stale → 새로 시작
          const cm = await client.send(
            new CreateMultipartUploadCommand({ Bucket: bucket, Key: key })
          );
          if (!cm.UploadId)
            throw new Error("CreateMultipartUpload: no UploadId");
          uploadId = cm.UploadId;
          parts = [];
          await store.save(key, { uploadId, partSize, parts });
        }
      } else {
        const cm = await client.send(
          new CreateMultipartUploadCommand({ Bucket: bucket, Key: key })
        );
        if (!cm.UploadId) throw new Error("CreateMultipartUpload: no UploadId");
        uploadId = cm.UploadId;
        parts = [];
        await store.save(key, { uploadId, partSize, parts });
      }

      try {
        let uploaded = parts.reduce((a, p) => a + (p.Size ?? 0), 0);
        onBytes(uploaded);
        // 완료 파트는 모두 partSize(마지막 파트는 완료 직전까지 없음) → uploaded 는 partSize 배수라
        // skip 이 다음 파트 경계에 정렬된다.
        let partNumber = parts.length;
        for await (const chunk of chunkFrom(body, partSize, uploaded, signal)) {
          if (signal.aborted) throw new Error("aborted");
          partNumber++;
          const up = await client.send(
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
              Body: chunk,
            })
          );
          parts.push({
            PartNumber: partNumber,
            ETag: up.ETag ?? "",
            Size: chunk.length,
          });
          uploaded += chunk.length;
          await store.save(key, { uploadId, partSize, parts });
          onBytes(uploaded);
        }
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
              Parts: parts.map(p => ({
                PartNumber: p.PartNumber,
                ETag: p.ETag,
              })),
            },
          })
        );
        await store.clear(key);
      } catch (err) {
        // 사용자 취소 → 멀티파트 정리(재개하지 않음). 크래시는 이 경로를 안 탄다(프로세스 종료).
        if (signal.aborted) {
          await client
            .send(
              new AbortMultipartUploadCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
              })
            )
            .catch(() => {});
          await store.clear(key).catch(() => {});
        }
        throw err;
      }
    },
  };
}

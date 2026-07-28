// KMX EDC — S3/MinIO 클라이언트 팩토리 (대량 전송 목적지)
//
// 대량 전송 워커(transferWorker)가 소스에서 pull 한 바이트를 이 목적지로 스트리밍 업로드한다.
// 목적지 구성은 사용자 입력(dataSink S3 필드) 우선, 없으면 서버 env 폴백으로 해석한다.
// 자격(accessKeyId/secretAccessKey)은 절대 저장/로깅하지 않는다(요청/env 에서만 사용).

import { S3Client } from "@aws-sdk/client-s3";

export interface S3Target {
  bucket: string;
  region: string;
  endpoint?: string; // MinIO 등 S3 호환 스토리지(endpointOverride)
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/** dataSink(사용자 입력) 우선, 없으면 서버 env 폴백으로 S3 목적지 구성을 해석한다. */
export function resolveS3Target(sink?: Record<string, unknown>): S3Target {
  const s = sink ?? {};
  const endpoint =
    (typeof s.endpointOverride === "string" && s.endpointOverride) ||
    process.env.S3_ENDPOINT ||
    undefined;
  const accessKeyId =
    (typeof s.accessKeyId === "string" && s.accessKeyId) ||
    process.env.S3_ACCESS_KEY_ID ||
    undefined;
  const secretAccessKey =
    (typeof s.secretAccessKey === "string" && s.secretAccessKey) ||
    process.env.S3_SECRET_ACCESS_KEY ||
    undefined;
  return {
    bucket: String(s.bucketName ?? process.env.S3_BUCKET ?? "").trim(),
    region: String(s.region ?? process.env.S3_REGION ?? "us-east-1").trim(),
    endpoint,
    accessKeyId,
    secretAccessKey,
    // MinIO 는 virtual-host 스타일 미지원이라 path-style 이 필요하다. endpoint(=S3 호환
    // 스토리지) 지정 시 기본 path-style on, env 로 강제 override 가능.
    forcePathStyle:
      process.env.S3_FORCE_PATH_STYLE === "true" || Boolean(endpoint),
  };
}

/** 목적지 구성이 업로드 가능한 최소 요건(bucket + 자격)을 갖췄는지. */
export function isS3TargetUsable(t: S3Target): boolean {
  return Boolean(t.bucket && t.accessKeyId && t.secretAccessKey);
}

export function makeS3Client(t: S3Target): S3Client {
  return new S3Client({
    region: t.region,
    ...(t.endpoint
      ? { endpoint: t.endpoint, forcePathStyle: t.forcePathStyle }
      : {}),
    ...(t.accessKeyId && t.secretAccessKey
      ? {
          credentials: {
            accessKeyId: t.accessKeyId,
            secretAccessKey: t.secretAccessKey,
          },
        }
      : {}),
  });
}

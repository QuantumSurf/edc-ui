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

/**
 * dataSink(사용자 입력) 우선, 없으면 서버 env 폴백으로 S3 목적지 구성을 해석한다.
 *
 * 보안: endpoint·accessKeyId·secretAccessKey 는 **all-or-nothing** 으로 취급한다. 사용자가
 * 셋 중 하나라도 dataSink 로 주면 그 셋은 전부 dataSink 에서만 취하고 env 와 섞지 않는다.
 * (혼합을 허용하면 "사용자 endpoint + 콘솔 env 자격" 조합으로 콘솔의 env 자격이 사용자가
 *  지정한 임의 endpoint 로 SigV4 서명돼 나가는 SSRF/자격 오배송이 성립한다.)
 */
export function resolveS3Target(sink?: Record<string, unknown>): S3Target {
  const s = sink ?? {};
  const sinkEndpoint =
    typeof s.endpointOverride === "string" && s.endpointOverride
      ? s.endpointOverride
      : "";
  const sinkAccess =
    typeof s.accessKeyId === "string" && s.accessKeyId ? s.accessKeyId : "";
  const sinkSecret =
    typeof s.secretAccessKey === "string" && s.secretAccessKey
      ? s.secretAccessKey
      : "";
  // 사용자가 endpoint/자격 중 하나라도 제공했으면 그 묶음은 dataSink 전용(env 미혼합).
  const userProvided = Boolean(sinkEndpoint || sinkAccess || sinkSecret);
  const endpoint = userProvided
    ? sinkEndpoint || undefined
    : process.env.S3_ENDPOINT || undefined;
  const accessKeyId = userProvided
    ? sinkAccess || undefined
    : process.env.S3_ACCESS_KEY_ID || undefined;
  const secretAccessKey = userProvided
    ? sinkSecret || undefined
    : process.env.S3_SECRET_ACCESS_KEY || undefined;
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

// KMX EDC — at-rest 시크릿 암호화 (AES-256-GCM)
//
// 커넥터 EDC API Key 등 DB 보관 시크릿을 평문 대신 암호문으로 저장한다(CWE-312).
// DB/백업/볼륨이 노출돼도 키 없이는 평문을 복원할 수 없게 한다(형제 aas-service-hub 와 동일 방식).
//
// 포맷: enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
// 키: HUB_APIKEY_SECRET 을 sha256 으로 32바이트 파생. prod 는 필수(fail-closed),
//     dev 는 고정 dev 키(저장소 노출 무방, dev 전용).

import crypto from "node:crypto";

const ENC_PREFIX = "enc:v1:";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  let secret = process.env.HUB_APIKEY_SECRET;
  if (!secret) {
    if (IS_PRODUCTION) {
      throw new Error(
        "[crypto] HUB_APIKEY_SECRET must be set in production for API key at-rest encryption"
      );
    }
    // dev 전용 고정 키 — 재시작 후에도 기존 암호문 복호화가 되도록 안정적이어야 한다.
    secret = "dev-insecure-apikey-encryption-key";
  }
  cachedKey = crypto.createHash("sha256").update(secret).digest();
  return cachedKey;
}

/** 이미 암호화된(enc:v1:) 값인지 여부. */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

/** 평문 → enc:v1 암호문. 빈 문자열은 그대로(암호화 의미 없음). */
export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  if (isEncrypted(plain)) return plain; // 멱등
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** enc:v1 암호문 → 평문. 레거시 평문(접두 없음)은 그대로 반환(이행기 호환). */
export function decryptSecret(stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored;
  const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !ctB64) return ""; // 손상된 형식 — 빈 값(노출보다 안전)
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ct = Buffer.from(ctB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    // GCM 인증 실패(HUB_APIKEY_SECRET 회전·다른 키로 복원한 백업·손상 등)로 여기서 throw 하면
    // rowToEntry 를 타는 listConnectors/getConnector 전체가 500 으로 죽어 그 테넌트의 플릿과
    // 모든 커넥터 화면이 깨진다. 빈 값을 반환해 해당 커넥터만 미인증(EDC 401)으로 격하한다.
    console.error(
      "[crypto] api_key 복호화 실패 — HUB_APIKEY_SECRET 회전/불일치 가능성(해당 커넥터만 미인증 처리)"
    );
    return "";
  }
}

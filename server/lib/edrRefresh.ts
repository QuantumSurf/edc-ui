// KMX EDC — EDR 토큰 자동 갱신(refresh) 헬퍼
//
// provider 데이터플레인이 발급하는 EDR 액세스 토큰은 단기(기본 5분)이며, 만료 시 pull 이 403 을
// 반환한다. EDR 에는 refresh 토큰과 refresh 엔드포인트가 함께 실려 오므로, 403 을 받으면 refresh
// 엔드포인트로 새 액세스 토큰을 받아 재시도한다(장시간/반복 pull 유지).
//
// provider 는 1회용 rotation 을 쓰므로(갱신 시 이전 refresh 토큰 무효화) 전송별로 최신 토큰 쌍을
// 공유 저장소(Postgres edr_tokens)에 보관한다. 멀티레플리카/재시작에서도 어느 인스턴스가 갱신하든
// 최신 토큰을 모두가 즉시 본다. 동시 refresh 는 행잠금(FOR UPDATE)으로 직렬화해, 겹친 갱신이
// 1회용 refresh 토큰을 서로 무효화하는 경합(spurious 403)을 제거한다. 토큰은 at-rest 암호화한다.

import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { assertEndpointPublic } from "../middleware/validation.js";
import { getPool } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

export interface EdrTokens {
  accessToken: string;
  refreshToken?: string;
  refreshEndpoint?: string;
}

/** EDR 응답에서 액세스/ refresh 토큰·엔드포인트를 추출(네임스페이스 접두 유무 모두 허용). */
export function edrTokensFromResponse(edr: Record<string, unknown>): EdrTokens {
  const pick = (suffix: string): string | undefined => {
    if (typeof edr[suffix] === "string") return edr[suffix] as string;
    // JSON-LD 확장으로 EDC 네임스페이스가 접두된 키도 허용.
    for (const [k, v] of Object.entries(edr)) {
      if (k.endsWith(suffix) && typeof v === "string") return v;
    }
    return undefined;
  };
  return {
    accessToken: (edr["authorization"] as string) ?? "",
    refreshToken: pick("refreshToken"),
    refreshEndpoint: pick("refreshEndpoint"),
  };
}

interface EdrRow {
  access_token: string;
  refresh_token: string | null;
  refresh_endpoint: string | null;
}

/** DB 행 → EdrTokens(복호화). 복호화 실패(키 회전 등)는 빈 액세스 토큰으로 격하 → 재조회 유도. */
function rowToTokens(row: EdrRow): EdrTokens {
  return {
    accessToken: row.access_token ? decryptSecret(row.access_token) : "",
    refreshToken: row.refresh_token
      ? decryptSecret(row.refresh_token) || undefined
      : undefined,
    refreshEndpoint: row.refresh_endpoint ?? undefined,
  };
}

/** 공유 저장소에서 전송별 최신 토큰을 읽는다(없으면 null). */
async function readTokens(
  connectorId: string,
  tpId: string
): Promise<EdrTokens | null> {
  const { rows } = await getPool().query<EdrRow>(
    `SELECT access_token, refresh_token, refresh_endpoint
       FROM edr_tokens WHERE connector_id = $1 AND tp_id = $2`,
    [connectorId, tpId]
  );
  if (rows.length === 0) return null;
  const t = rowToTokens(rows[0]);
  return t.accessToken ? t : null; // 복호화 실패 행은 없는 것으로 간주
}

/** 최초 pull 시 EDR 원본 토큰을 저장한다. 이미 있으면(갱신된 행) 덮어쓰지 않는다. */
async function insertInitial(
  connectorId: string,
  tpId: string,
  tokens: EdrTokens
): Promise<void> {
  await getPool().query(
    `INSERT INTO edr_tokens (connector_id, tp_id, access_token, refresh_token, refresh_endpoint, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (connector_id, tp_id) DO NOTHING`,
    [
      connectorId,
      tpId,
      encryptSecret(tokens.accessToken),
      tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      tokens.refreshEndpoint ?? null,
    ]
  );
}

/**
 * 공유 저장소의 최신 토큰이 있으면 반환, 없으면 EDR 응답에서 추출해 저장 후 반환.
 * 다른 레플리카가 이미 refresh 해 저장한 토큰이 있으면 그 최신값을 쓴다.
 */
export async function resolveEdrTokens(
  connectorId: string,
  tpId: string,
  edr: Record<string, unknown>
): Promise<EdrTokens> {
  const stored = await readTokens(connectorId, tpId);
  if (stored) return stored;
  const tokens = edrTokensFromResponse(edr);
  await insertInitial(connectorId, tpId, tokens);
  // 삽입과 동시에 다른 요청이 refresh 했을 수 있으니 최종 저장값을 한 번 더 읽어 최신을 보장.
  return (await readTokens(connectorId, tpId)) ?? tokens;
}

/** 전송 종료/삭제 시 공유 저장소 정리(불필요한 자격증명 상주 최소화). best-effort. */
export async function evictEdrTokens(
  connectorId: string,
  tpId: string
): Promise<void> {
  await getPool().query(
    `DELETE FROM edr_tokens WHERE connector_id = $1 AND tp_id = $2`,
    [connectorId, tpId]
  );
}

/** 완료/종료 후 남은 오래된 EDR 토큰 행 정리(보존기간 초과분 삭제). best-effort. */
export async function pruneEdrTokens(
  maxAgeMs: number = 24 * 60 * 60 * 1000
): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  await getPool().query(`DELETE FROM edr_tokens WHERE updated_at < $1`, [
    cutoff,
  ]);
}

// refresh 응답은 소형 JSON(토큰 쌍)뿐 — 악성/침해 provider 가 강제하는 대용량 응답 버퍼링/동기
// 파싱으로 공유 BFF 힙을 OOM 시키는 것을 차단한다(pull 경로의 크기상한 가드와 동일 정책).
const REFRESH_MAX_BYTES = 64 * 1024;

// 같은 전송(connectorId:tpId)의 동시 refresh 를 프로세스 내에서 1회로 합친다(intra-process
// single-flight). 크로스 레플리카 직렬화는 아래 doRefresh 의 행잠금(FOR UPDATE)이 담당한다.
const inflightRefresh = new Map<string, Promise<EdrTokens | null>>();

function refreshTokens(
  connectorId: string,
  tpId: string,
  tokens: EdrTokens
): Promise<EdrTokens | null> {
  const k = `${connectorId}:${tpId}`;
  const existing = inflightRefresh.get(k);
  if (existing) return existing;
  const p = doRefresh(connectorId, tpId, tokens).finally(() =>
    inflightRefresh.delete(k)
  );
  inflightRefresh.set(k, p);
  return p;
}

/** refresh 엔드포인트로 새 액세스+refresh 쌍을 받는다(HTTP). 실패 시 null. */
async function performHttpRefresh(
  tokens: EdrTokens
): Promise<EdrTokens | null> {
  if (!tokens.refreshToken || !tokens.refreshEndpoint) return null;
  // refresh 엔드포인트는 미신뢰 provider 데이터플레인이 EDR 로 반환한 값 — SSRF 가드 적용.
  if (await assertEndpointPublic(tokens.refreshEndpoint)) return null;
  try {
    const resp = await axios.post(
      tokens.refreshEndpoint,
      { refresh_token: tokens.refreshToken },
      {
        timeout: 10_000,
        maxRedirects: 0,
        maxContentLength: REFRESH_MAX_BYTES,
        maxBodyLength: REFRESH_MAX_BYTES,
      }
    );
    const data = resp.data as { access_token?: string; refresh_token?: string };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      refreshEndpoint: tokens.refreshEndpoint,
    };
  } catch {
    return null;
  }
}

/**
 * 크로스 레플리카 원자 refresh — 전송 행을 FOR UPDATE 로 잠근 뒤,
 *  ① 잠금 획득 사이 다른 레플리카가 이미 refresh 했으면(저장된 토큰이 우리 stale 토큰과 다르면)
 *     HTTP refresh 없이 그 최신 토큰을 반환한다(중복 refresh·1회용 토큰 경합 제거).
 *  ② 아직 아무도 안 했으면 우리가 HTTP refresh 하고, 같은 트랜잭션에서 UPSERT 후 커밋한다.
 * lock_timeout 으로 잠금 대기가 무한정 늘어지지 않게 하고, 실패 시 null(호출부가 원 403 을 전파).
 */
async function doRefresh(
  connectorId: string,
  tpId: string,
  tokens: EdrTokens
): Promise<EdrTokens | null> {
  if (!tokens.refreshToken || !tokens.refreshEndpoint) return null;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // refresh HTTP(최대 10s)를 잠금 안에서 수행하므로 대기 상한을 그보다 넉넉히 둔다.
    await client.query("SET LOCAL lock_timeout = '12s'");
    const locked = await client.query<EdrRow>(
      `SELECT access_token, refresh_token, refresh_endpoint
         FROM edr_tokens WHERE connector_id = $1 AND tp_id = $2 FOR UPDATE`,
      [connectorId, tpId]
    );
    if (locked.rows.length > 0) {
      const cur = rowToTokens(locked.rows[0]);
      if (cur.accessToken && cur.accessToken !== tokens.accessToken) {
        // 다른 레플리카가 이미 갱신함 — 그 토큰을 재사용.
        await client.query("COMMIT");
        return cur;
      }
    }
    const next = await performHttpRefresh(tokens);
    if (!next) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `INSERT INTO edr_tokens (connector_id, tp_id, access_token, refresh_token, refresh_endpoint, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (connector_id, tp_id) DO UPDATE
           SET access_token = EXCLUDED.access_token,
               refresh_token = EXCLUDED.refresh_token,
               refresh_endpoint = EXCLUDED.refresh_endpoint,
               updated_at = NOW()`,
      [
        connectorId,
        tpId,
        encryptSecret(next.accessToken),
        next.refreshToken ? encryptSecret(next.refreshToken) : null,
        next.refreshEndpoint ?? null,
      ]
    );
    await client.query("COMMIT");
    return next;
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* 이미 끊긴 트랜잭션 — 무시 */
    }
    return null;
  } finally {
    client.release();
  }
}

/**
 * EDR 데이터 pull — 액세스 토큰으로 GET 하고, 403(만료)이면 refresh 후 1회 재시도한다.
 * axiosConfig 에 Authorization 이외의 옵션(responseType·timeout·maxContentLength·maxRedirects 등)을 전달.
 */
export async function pullEdrData(
  connectorId: string,
  tpId: string,
  targetUrl: string,
  edr: Record<string, unknown>,
  axiosConfig: AxiosRequestConfig
): Promise<AxiosResponse> {
  const tokens = await resolveEdrTokens(connectorId, tpId, edr);
  try {
    return await axios.get(targetUrl, {
      ...axiosConfig,
      headers: {
        ...axiosConfig.headers,
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response
      ?.status;
    if (status !== 403) throw err;
    const refreshed = await refreshTokens(connectorId, tpId, tokens);
    if (!refreshed) throw err;
    return await axios.get(targetUrl, {
      ...axiosConfig,
      headers: {
        ...axiosConfig.headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
      },
    });
  }
}

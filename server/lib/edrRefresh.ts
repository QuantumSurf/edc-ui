// KMX EDC — EDR 토큰 자동 갱신(refresh) 헬퍼
//
// provider 데이터플레인이 발급하는 EDR 액세스 토큰은 단기(기본 5분)이며, 만료 시 pull 이 403 을
// 반환한다. 403 을 받으면 커넥터 Management API 의 강제 갱신 엔드포인트
// (POST /v3/edrs/{transferProcessId}/refresh, kmx-token-refresh-controlplane 확장)를 호출해
// 새 액세스 토큰을 받아 재시도한다(장시간/반복 pull 유지).
//
// 데이터플레인 public /token 엔드포인트(grant_type=refresh_token)는 consumer 자체 발급 JWT
// (Authorization: Bearer)를 요구하는데 BFF 는 커넥터의 STS 키를 갖지 않아 서명할 수 없다 —
// 토큰 갱신은 반드시 관리 API 경유로만 가능하다.
//
// 전송별 최신 토큰은 공유 저장소(Postgres edr_tokens)에 보관한다. 멀티레플리카/재시작에서도
// 어느 인스턴스가 갱신하든 최신 토큰을 모두가 즉시 본다. 동시 refresh 는 행잠금(FOR UPDATE)으로
// 직렬화해, 겹친 갱신이 1회용 refresh 토큰을 서로 무효화하는 경합(spurious 403)을 제거한다.
// 토큰은 at-rest 암호화한다.

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { getPool } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

export interface EdrTokens {
  accessToken: string;
  refreshToken?: string;
  refreshEndpoint?: string;
}

/** EDR/DataAddress 응답에서 액세스/refresh 토큰·엔드포인트를 추출(네임스페이스 접두 유무 모두 허용). */
export function edrTokensFromResponse(edr: Record<string, unknown>): EdrTokens {
  const pick = (suffix: string): string | undefined => {
    if (typeof edr[suffix] === "string") return edr[suffix] as string;
    // JSON-LD 확장으로 EDC/kmx-auth 네임스페이스가 접두된 키도 허용.
    for (const [k, v] of Object.entries(edr)) {
      if (k.endsWith(suffix) && typeof v === "string") return v;
    }
    return undefined;
  };
  return {
    accessToken: pick("authorization") ?? "",
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

// 같은 전송(connectorId:tpId)의 동시 refresh 를 프로세스 내에서 1회로 합친다(intra-process
// single-flight). 크로스 레플리카 직렬화는 아래 doRefresh 의 행잠금(FOR UPDATE)이 담당한다.
const inflightRefresh = new Map<string, Promise<EdrTokens | null>>();

function refreshTokens(
  mgmtClient: AxiosInstance,
  connectorId: string,
  tpId: string,
  tokens: EdrTokens
): Promise<EdrTokens | null> {
  const k = `${connectorId}:${tpId}`;
  const existing = inflightRefresh.get(k);
  if (existing) return existing;
  const p = doRefresh(mgmtClient, connectorId, tpId, tokens).finally(() =>
    inflightRefresh.delete(k)
  );
  inflightRefresh.set(k, p);
  return p;
}

/**
 * Management API 강제 갱신 — POST /v3/edrs/{tpId}/refresh 는 threshold 를 무시하고 즉시
 * 새 토큰 쌍을 발급한 뒤, 갱신된 DataAddress(authorization + kmx-auth refresh 프로퍼티)를
 * 반환한다. 관리 URL 은 관리자가 등록한 신뢰 대상이므로 SSRF 가드는 불필요. 실패 시 null.
 */
async function performManagementRefresh(
  mgmtClient: AxiosInstance,
  tpId: string
): Promise<EdrTokens | null> {
  try {
    const resp = await mgmtClient.post(
      `/v3/edrs/${encodeURIComponent(tpId)}/refresh`
    );
    const next = edrTokensFromResponse(resp.data as Record<string, unknown>);
    return next.accessToken ? next : null;
  } catch {
    return null;
  }
}

/**
 * 크로스 레플리카 원자 refresh — 전송 행을 FOR UPDATE 로 잠근 뒤,
 *  ① 잠금 획득 사이 다른 레플리카가 이미 refresh 했으면(저장된 토큰이 우리 stale 토큰과 다르면)
 *     관리 API 호출 없이 그 최신 토큰을 반환한다(중복 refresh·1회용 토큰 경합 제거).
 *  ② 아직 아무도 안 했으면 우리가 관리 API 로 refresh 하고, 같은 트랜잭션에서 UPSERT 후 커밋한다.
 * lock_timeout 으로 잠금 대기가 무한정 늘어지지 않게 하고, 실패 시 null(호출부가 원 403 을 전파).
 */
async function doRefresh(
  mgmtClient: AxiosInstance,
  connectorId: string,
  tpId: string,
  tokens: EdrTokens
): Promise<EdrTokens | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // 관리 API refresh(기본 10s 타임아웃)를 잠금 안에서 수행하므로 대기 상한을 그보다 넉넉히 둔다.
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
    const next = await performManagementRefresh(mgmtClient, tpId);
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
 * EDR 데이터 pull — 액세스 토큰으로 GET 하고, 403(만료)이면 관리 API refresh 후 1회 재시도한다.
 * mgmtClient 는 해당 커넥터의 Management API axios 인스턴스(X-Api-Key 포함).
 * axiosConfig 에 Authorization 이외의 옵션(responseType·timeout·maxContentLength·maxRedirects 등)을 전달.
 */
export async function pullEdrData(
  mgmtClient: AxiosInstance,
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
    const refreshed = await refreshTokens(
      mgmtClient,
      connectorId,
      tpId,
      tokens
    );
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

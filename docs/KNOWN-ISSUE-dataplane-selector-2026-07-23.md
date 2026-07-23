# 알려진 이슈 — 데이터플레인 셀렉터 등록이 `REGISTERED` 에 고착 (2026-07-23)

> **상태: 고치지 않음(의도적). 지금 실피해 0, 그러나 EDC 업그레이드 시 하드 블로커.**
> 이 문서는 "몰라서 당하는 것"을 막기 위한 박제다. 발견 경위는 IdentityHub 변경 후
> 주변 시스템 회귀 점검 중이며, **이 이슈는 그 변경과 무관하게 이전부터 존재**했다.

| 항목 | 값 |
|---|---|
| 심각도 | 🟡 지금 0 / 🔴 EDC 업그레이드 시 Blocker |
| 최초 발생 | **2026-07-21** (컨트롤플레인 로그) — 2026-07-22~23 IH 작업 **이전** |
| 발생 횟수 | 286회 (전송 1건당 1회) |
| 영향 대상 | `kmx-provider-controlplane` / `kmx-consumer-controlplane` / `kmx-vendor2-controlplane` |
| 현재 전송 | ✅ 정상 (실 데이터 PULL 까지 확인) |

## 1. 증상

공급자 컨트롤플레인 로그:

```
WARNING Data Flow preparation failed, please note that this phase will become
mandatory in the upcoming versions so please ensure that there's a data-plane
able to manage the transfer-type HttpData-PULL. Error: No dataplane found
```

## 2. 근본 원인 (대조 실험으로 확정)

**데이터플레인 인스턴스가 `REGISTERED` 상태에 갇혀 `AVAILABLE` 로 승격되지 않는다.**
셀렉터는 `AVAILABLE` 인 것만 고르므로 "쓸 수 있는 데이터플레인 없음"이 된다.

### 확정 실험

인스턴스 **1건만** `state: 100(REGISTERED)` → `200(AVAILABLE)` 로 바꾸고 전송 실행:

| 조건 | 경고 발생 |
|---|---|
| REGISTERED (원래 상태) | 전송마다 발생 |
| **AVAILABLE 로 변경** | **286 → 286, 증가 0건** |

→ 상태값 하나로 경고가 사라졌으므로 **원인은 상태**다. (실험 후 원복 완료)

### 배제된 가설 (전부 확인함)

| 의심 | 실제 |
|---|---|
| 데이터플레인 미등록 | ❌ 7건 등록돼 있음 |
| 전송타입 불일치 | ❌ `allowedTransferTypes` 에 `HttpData-PULL` 포함 |
| 소스타입 불일치 | ❌ 자산 `dataAddress.type=HttpData` = `allowedSourceTypes` 일치 |
| 네트워크 단절 | ❌ controlplane→dataplane 헬스체크 **HTTP 204 정상** |
| `destinationProvisionTypes: []` 때문 | ❌ 실험 중에도 여전히 `[]` 인데 경고 사라짐 |
| **상태가 REGISTERED** | ✅ **이것** |

### 왜 승격되지 않나

**데이터플레인이 기동 시 1회만 자체 등록하고, 이후 하트비트가 전혀 없다.**

`lastActive` 값이 컨테이너 기동 시각과 **정확히 일치**한다:

| 인스턴스 lastActive | 데이터플레인 기동 |
|---|---|
| 2026-07-23 05:26:00 | 2026-07-23T05:25:51 ✅ |
| 2026-07-21 06:50:56 | (7-21 재기동) |
| 2026-07-20 02:07:30 | (7-20 재기동) |

즉 인스턴스 7건 = **재기동 7번의 잔재**이고, `turnCount = 0` 은 컨트롤플레인의 셀렉터
상태머신이 **이 인스턴스들을 한 번도 처리한 적 없음**을 뜻한다. (셀렉터 모듈 자체는
`controlplane.jar` 에 존재 — 관련 클래스 54개 확인.)

## 3. 현재 영향 — 없음 (실측)

전송 실행 경로는 **다른 필터**(transferType/sourceType)를 쓰고 그건 전부 맞아서 동작한다.
실패하는 것은 새로 생긴 **preparation(provisioning) 단계**뿐이며 이 단계는 아직 선택적이다.

실측(2026-07-23): 카탈로그 → 협상 **FINALIZED** → 전송 **STARTED** → **실 데이터 PULL 성공**
(데이터플레인이 원본을 프록시해 그대로 전달, 원본 직접 호출과 동일 응답).

## 4. 그래도 남는 비용 4가지

1. **EDC 업그레이드 시 하드 블로커** — 경고문대로 "향후 버전에서 필수". 제거가 아니라 **연기**된 위험.
2. **🔴 데이터플레인 생존 신호가 없다** — 7건 전부 `REGISTERED` + `lastActive` 고정이라,
   **데이터플레인이 실제로 죽어도 컨트롤플레인은 알 수 없다.** 죽은 것과 살아있는 것이
   셀렉터상 구분되지 않는다. 이건 미래 위험이 아니라 **지금 이미 없는 안전장치**다.
3. **로그 노이즈 누적** — 전송 1건당 1줄. 진짜 신호가 묻힌다.
4. **인스턴스 누수** — 재기동마다 +1, 정리 경로 없음(현재 7건).

## 5. 왜 지금 고치지 않나 — 고치는 행위의 위험이 더 즉시적이다

| # | 위험 |
|---|---|
| 1 | **한 번도 안 돌던 코드 경로가 켜진다.** 지금은 preparation 이 즉시 실패→레거시 폴백으로 전송 성공. 고치면 그 단계가 실제 실행되는데, `destinationProvisionTypes: []`·`allowedDestTypes: []` 가 비어 있어 **다른 방식으로 실패할 수 있다.** "경고 없애려다 잘 되던 전송을 깨는" 시나리오. |
| 2 | **상태머신은 강등도 한다.** 하트비트가 없는 상태에서 상태머신만 켜면 `AVAILABLE`→**`UNAVAILABLE`** 로 내려가고, 그게 일반 전송 경로에서도 배제 대상이면 **지금 되던 전송까지 깨진다.** (UNAVAILABLE 이 일반 경로를 막는지는 **미검증**) |
| 3 | **정리 순서** — 7건을 전부 지우고 재기동을 안 하면 0건이 되어 확실히 깨진다. 정리는 **재기동과 세트**. |
| 4 | **공유 스택** — pcf-exchange·vendor2·fl 스택이 같이 쓴다(협상 이력 46k~62k = 실사용). 재기동이 진행 중 작업을 끊는다. |
| 5 | **버전 결합** — 커넥터 jar 는 2026-07-02 빌드로 IH(0.16.0)와 다를 수 있다. 설정 키가 버전마다 달라 오설정 위험. |

> ⚠️ **함정**: `state=200` 으로 DB 를 UPDATE 하는 건 **수정이 아니다.** 재등록되면 덮이고,
> 하트비트가 없어 또 낡는다. 해결책으로 박으면 거짓 안심만 남는다. (위 실험은 원인 규명용이며 원복함)

## 6. 언제·어떻게 고치나

**트리거: EDC 업그레이드.** 그때는 어차피 회귀 테스트를 도므로 함께 검증하는 것이 가장 안전하다.
**이 문서를 EDC 업그레이드 티켓에 블로커로 연결할 것.**

안전한 순서:

1. 현재 정상 동작(전송 E2E 성공)을 **기준선으로 기록**
2. **하트비트를 먼저** 고친다 (상태머신을 먼저 켜면 위험 #2)
3. 그 다음 셀렉터 상태머신 — **한 번에 하나씩**, 매번 전송 E2E 재확인
4. 낡은 인스턴스 정리는 **재기동과 세트**
5. 유휴 시간대에 수행

## 7. 재현·확인 명령

```bash
# 등록된 인스턴스와 상태 (state 100 = REGISTERED, turnCount 0 = 미처리)
docker exec kmx-platform-postgres psql -U kmxedc -d kmxedc -tAc \
  "SELECT id, data::json->>'state', data::json->>'lastActive', data::json->>'turnCount'
   FROM edc_data_plane_instance ORDER BY (data::json->>'lastActive')::bigint DESC;"

# 컨트롤플레인 → 데이터플레인 도달 확인 (204 면 정상)
docker run --rm --network kmx-ih_default curlimages/curl:latest -s -o /dev/null \
  -w '%{http_code}\n' http://provider-dataplane:8082/control/v1/dataflows/check

# 경고 누적 횟수
docker logs kmx-provider-controlplane 2>&1 | grep -c "No dataplane found"
```

/**
 * Mock EDC Management API — dev/UI 데모용 (무의존 Node http).
 * BFF(server/)가 호출하는 /v3/* 엔드포인트에 EDC JSON-LD 형태의 canned 응답을 돌려줘
 * 자산·정책·오퍼링·협상·전송·EDR·카탈로그 화면을 실데이터처럼 채운다.
 * 실제 EDC 커넥터 없이 UI/UX 작업이 가능하도록 하는 용도이며, 인증은 검사하지 않는다.
 */
const http = require("http");

const PORT = process.env.MOCK_PORT ? parseInt(process.env.MOCK_PORT, 10) : 8090;
const now = Date.now();
const h = n => now - n * 3600 * 1000; // n시간 전(ms)

/* ── Canned 데이터 ───────────────────────────────────────────── */
const assets = [
  {
    "@id": "asset-pcf-battery-001",
    properties: {
      name: "Battery PCF Dataset",
      description: "제품 탄소발자국 데이터셋 — 고전압 배터리 모듈",
      "cx-common:version": "1.2.0",
      "dct:type": { "@id": "cx-taxo:PcfExchange" },
      semanticId: "urn:samm:io.catenax.pcf:7.0.0#Pcf",
    },
    createdAt: h(120),
    dataAddress: {
      type: "HttpData",
      baseUrl: "http://provider-data:8080/pcf/battery",
      proxyPath: "true",
      contentType: "application/json",
    },
  },
  {
    "@id": "asset-pcf-motor-002",
    properties: {
      name: "E-Motor PCF Dataset",
      description: "구동 모터 탄소발자국 데이터셋",
      "cx-common:version": "1.0.0",
      "dct:type": { "@id": "cx-taxo:PcfExchange" },
      semanticId: "urn:samm:io.catenax.pcf:7.0.0#Pcf",
    },
    createdAt: h(96),
    dataAddress: {
      type: "HttpData",
      baseUrl: "http://provider-data:8080/pcf/motor",
      proxyPath: "true",
      contentType: "application/json",
    },
  },
  {
    "@id": "asset-dcm-forecast-003",
    properties: {
      name: "Demand Forecast (DCM)",
      description: "수요·용량 관리 예측 데이터",
      "cx-common:version": "2.1.0",
      "dct:type": { "@id": "cx-taxo:DemandAndCapacityManagement" },
    },
    createdAt: h(72),
    dataAddress: {
      type: "HttpData",
      baseUrl: "http://provider-data:8080/dcm",
      proxyPath: "false",
      contentType: "application/json",
    },
  },
  {
    "@id": "asset-dtr-registry-004",
    properties: {
      name: "Digital Twin Registry",
      description: "AAS 디지털 트윈 레지스트리 프록시 자산",
      "cx-common:version": "1.0.0",
      "dct:type": { "@id": "cx-taxo:DigitalTwinRegistry" },
      "kmx:aasVersion": "3.0",
    },
    createdAt: h(48),
    dataAddress: {
      type: "HttpData",
      baseUrl: "http://platform-dtr:4243/semantics/registry",
      proxyPath: "true",
      proxyQueryParams: "true",
      contentType: "application/json",
    },
  },
  {
    "@id": "asset-traceability-005",
    properties: {
      name: "Traceability — Serial Parts",
      description: "부품 추적성(시리얼) 데이터셋",
      "cx-common:version": "3.0.0",
      "dct:type": { "@id": "cx-taxo:Traceability" },
      semanticId: "urn:samm:io.catenax.serial_part:3.0.0#SerialPart",
    },
    createdAt: h(24),
    dataAddress: {
      type: "HttpData",
      baseUrl: "http://provider-data:8080/traceability",
      proxyPath: "true",
      contentType: "application/json",
    },
  },
];

const policies = [
  {
    "@id": "policy-access-bpn",
    policy: {
      "odrl:permission": [
        {
          "odrl:action": { "@id": "odrl:use" },
          "odrl:constraint": [
            {
              "odrl:leftOperand": "BusinessPartnerNumber",
              "odrl:operator": { "@id": "odrl:eq" },
              "odrl:rightOperand": "BPNL000000000CON",
            },
          ],
        },
      ],
    },
  },
  {
    "@id": "policy-usage-membership",
    policy: {
      "odrl:permission": [
        {
          "odrl:action": { "@id": "odrl:use" },
          "odrl:constraint": [
            {
              "odrl:leftOperand": "Membership",
              "odrl:operator": { "@id": "odrl:eq" },
              "odrl:rightOperand": "active",
            },
          ],
        },
      ],
    },
  },
  {
    "@id": "policy-open",
    policy: { "odrl:permission": [{ "odrl:action": { "@id": "odrl:use" } }] },
  },
];

const contractDefinitions = [
  {
    "@id": "offer-battery",
    accessPolicyId: "policy-access-bpn",
    contractPolicyId: "policy-usage-membership",
    assetsSelector: [{ operandRight: "asset-pcf-battery-001" }],
  },
  {
    "@id": "offer-motor",
    accessPolicyId: "policy-access-bpn",
    contractPolicyId: "policy-usage-membership",
    assetsSelector: [{ operandRight: "asset-pcf-motor-002" }],
  },
  {
    "@id": "offer-dcm",
    accessPolicyId: "policy-open",
    contractPolicyId: "policy-open",
    assetsSelector: [{ operandRight: "asset-dcm-forecast-003" }],
  },
];

const negotiations = [
  {
    "@id": "neg-001",
    state: "FINALIZED",
    createdAt: h(50),
    contractAgreementId: "agreement-001",
    assetId: "asset-pcf-battery-001",
    counterPartyId: "BPNL000000000CON",
    counterPartyAddress: "http://mock-edc:8090/api/v1/dsp",
  },
  {
    "@id": "neg-002",
    state: "FINALIZED",
    createdAt: h(30),
    contractAgreementId: "agreement-002",
    assetId: "asset-pcf-motor-002",
    counterPartyId: "BPNL000000000CON",
    counterPartyAddress: "http://mock-edc:8090/api/v1/dsp",
  },
  {
    "@id": "neg-003",
    state: "AGREED",
    createdAt: h(6),
    contractAgreementId: "agreement-003",
    assetId: "asset-dcm-forecast-003",
    counterPartyId: "BPNL000000000CON",
    counterPartyAddress: "http://mock-edc:8090/api/v1/dsp",
  },
  {
    "@id": "neg-004",
    state: "REQUESTING",
    createdAt: h(1),
    assetId: "asset-traceability-005",
    counterPartyId: "BPNL000000000CON",
    counterPartyAddress: "http://mock-edc:8090/api/v1/dsp",
  },
  {
    "@id": "neg-005",
    state: "TERMINATED",
    createdAt: h(20),
    assetId: "asset-pcf-motor-002",
    counterPartyId: "BPNL000000000CON",
    counterPartyAddress: "http://mock-edc:8090/api/v1/dsp",
    errorDetail: "Policy evaluation failed: BusinessPartnerNumber mismatch",
  },
];

const transfers = [
  {
    "@id": "transfer-001",
    state: "COMPLETED",
    createdAt: h(50),
    stateTimestamp: h(49),
    transferType: "HttpData-PULL",
    contractAgreementId: "agreement-001",
    assetId: "asset-pcf-battery-001",
    connectorId: "BPNL000000000CON",
  },
  {
    "@id": "transfer-002",
    state: "COMPLETED",
    createdAt: h(30),
    stateTimestamp: h(29),
    transferType: "HttpData-PULL",
    contractAgreementId: "agreement-002",
    assetId: "asset-pcf-motor-002",
    connectorId: "BPNL000000000CON",
  },
  {
    "@id": "transfer-003",
    state: "STARTED",
    createdAt: h(3),
    stateTimestamp: h(2),
    transferType: "HttpData-PULL",
    contractAgreementId: "agreement-003",
    assetId: "asset-dcm-forecast-003",
    connectorId: "BPNL000000000CON",
  },
  {
    "@id": "transfer-004",
    state: "TERMINATED",
    createdAt: h(20),
    stateTimestamp: h(18),
    transferType: "HttpData-PUSH",
    contractAgreementId: "agreement-002",
    assetId: "asset-pcf-motor-002",
    connectorId: "BPNL000000000CON",
    errorDetail: "Data plane timeout",
  },
];

const edrs = [
  {
    "@id": "edr-transfer-001",
    transferProcessId: "transfer-001",
    assetId: "asset-pcf-battery-001",
    providerId: "BPNL000000000PRD",
    createdAt: h(49),
    expiresAt: now + 3600 * 1000,
  },
  {
    "@id": "edr-transfer-002",
    transferProcessId: "transfer-002",
    assetId: "asset-pcf-motor-002",
    providerId: "BPNL000000000PRD",
    createdAt: h(29),
    expiresAt: now + 1800 * 1000,
  },
  {
    "@id": "edr-transfer-003",
    transferProcessId: "transfer-003",
    assetId: "asset-dcm-forecast-003",
    providerId: "BPNL000000000PRD",
    createdAt: h(2),
    expiresAt: now + 5400 * 1000,
  },
];

const catalog = {
  participantId: "BPNL000000000PRD",
  service: [{ endpointURL: "http://mock-edc:8090/api/v1/dsp" }],
  "dcat:dataset": contractDefinitions.map(cd => {
    const assetId = cd.assetsSelector[0].operandRight;
    const asset = assets.find(a => a["@id"] === assetId) || {};
    return {
      "@id": assetId,
      name: asset.properties?.name ?? assetId,
      "dct:type": asset.properties?.["dct:type"] ?? { "@id": "cx-taxo:Asset" },
      "odrl:hasPolicy": [
        {
          "@id": cd["@id"],
          "@type": "odrl:Offer",
          "odrl:permission": [{ "odrl:action": { "@id": "odrl:use" } }],
        },
      ],
      "dcat:distribution": [
        {
          "dcat:accessURL": "http://mock-edc:8090",
          accessService: { endpointURL: "http://mock-edc:8090/api/v1/dsp" },
        },
      ],
    };
  }),
};

const health = {
  isSystemHealthy: true,
  componentResults: [
    { component: "mock-edc", isHealthy: true },
    { component: "sts-service", isHealthy: true },
    { component: "did-resolver", isHealthy: true },
    { component: "credential-store", isHealthy: true },
  ],
};

/* ── IdentityHub — 참가자 검증가능 자격증명(VC) ─────────────────── */
const ihCredentials = [
  {
    id: "cred-membership",
    state: "ISSUED",
    verifiableCredential: {
      credential: {
        id: "urn:uuid:vc-membership-001",
        type: ["VerifiableCredential", "MembershipCredential"],
        issuer: { id: "did:web:identityhub:issuer" },
      },
    },
  },
  {
    id: "cred-bpn",
    state: "ISSUED",
    verifiableCredential: {
      credential: {
        id: "urn:uuid:vc-bpn-001",
        type: ["VerifiableCredential", "BpnCredential"],
        issuer: { id: "did:web:identityhub:issuer" },
      },
    },
  },
  {
    id: "cred-dataex",
    state: "ISSUED",
    verifiableCredential: {
      credential: {
        id: "urn:uuid:vc-dataex-001",
        type: ["VerifiableCredential", "DataExchangeGovernanceCredential"],
        issuer: { id: "did:web:dataspace-authority" },
      },
    },
  },
  {
    id: "cred-pcf",
    state: "ISSUED",
    verifiableCredential: {
      credential: {
        id: "urn:uuid:vc-pcf-001",
        type: ["VerifiableCredential", "UsagePurposeCredential"],
        issuer: { id: "did:web:dataspace-authority" },
      },
    },
  },
];

/* ── Digital Twin Registry (DTR) — shell descriptors ──────────── */
const dtrShells = [
  {
    id: "urn:uuid:shell-battery-001",
    idShort: "BatteryModule_Shell",
    globalAssetId: "urn:uuid:asset-battery-001",
    description: [
      { language: "ko", text: "고전압 배터리 모듈 디지털 트윈" },
      { language: "en", text: "HV battery module digital twin" },
    ],
    specificAssetIds: [
      { name: "manufacturerPartId", value: "BAT-MOD-001" },
      { name: "partInstanceId", value: "SN-BAT-12345" },
    ],
    submodelDescriptors: [
      {
        id: "urn:uuid:sm-pcf-001",
        idShort: "Pcf",
        semanticId: {
          keys: [
            {
              type: "GlobalReference",
              value: "urn:samm:io.catenax.pcf:7.0.0#Pcf",
            },
          ],
        },
        endpoints: [
          {
            interface: "SUBMODEL-3.0",
            protocolInformation: {
              href: "http://mock-edc:8090/data/pcf",
              endpointProtocol: "HTTP",
              endpointProtocolVersion: ["1.1"],
              subprotocol: "DSP",
            },
          },
        ],
      },
    ],
    createdAt: new Date(h(120)).toISOString(),
  },
  {
    id: "urn:uuid:shell-motor-002",
    idShort: "EMotor_Shell",
    globalAssetId: "urn:uuid:asset-motor-002",
    description: [
      { language: "ko", text: "구동 모터 디지털 트윈" },
      { language: "en", text: "E-Motor digital twin" },
    ],
    specificAssetIds: [{ name: "manufacturerPartId", value: "EMOTOR-002" }],
    submodelDescriptors: [
      {
        id: "urn:uuid:sm-sp-002",
        idShort: "SerialPart",
        semanticId: {
          keys: [
            {
              type: "GlobalReference",
              value: "urn:samm:io.catenax.serial_part:3.0.0#SerialPart",
            },
          ],
        },
        endpoints: [
          {
            interface: "SUBMODEL-3.0",
            protocolInformation: {
              href: "http://mock-edc:8090/data/serialpart",
              endpointProtocol: "HTTP",
              endpointProtocolVersion: ["1.1"],
              subprotocol: "DSP",
            },
          },
        ],
      },
    ],
    createdAt: new Date(h(72)).toISOString(),
  },
  {
    id: "urn:uuid:shell-traceability-003",
    idShort: "SerialPart_Shell",
    globalAssetId: "urn:uuid:asset-traceability-005",
    description: [
      { language: "ko", text: "부품 추적성 디지털 트윈" },
      { language: "en", text: "Traceability digital twin" },
    ],
    specificAssetIds: [{ name: "van", value: "VAN-2026-0003" }],
    submodelDescriptors: [],
    createdAt: new Date(h(24)).toISOString(),
  },
];

/* ── 라우팅 ──────────────────────────────────────────────────── */
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  const { method } = req;
  const url = (req.url || "").split("?")[0];
  let body = "";
  req.on("data", c => {
    body += c;
  });
  req.on("end", () => {
    // 목록(request) 엔드포인트 — 배열 반환
    if (method === "POST" && url === "/v3/assets/request")
      return send(res, 200, assets);
    if (method === "POST" && url === "/v3/policydefinitions/request")
      return send(res, 200, policies);
    if (method === "POST" && url === "/v3/contractdefinitions/request")
      return send(res, 200, contractDefinitions);
    if (method === "POST" && url === "/v3/contractnegotiations/request")
      return send(res, 200, negotiations);
    if (method === "POST" && url === "/v3/transferprocesses/request")
      return send(res, 200, transfers);
    if (method === "POST" && url === "/v3/edrs/request")
      return send(res, 200, edrs);
    if (method === "POST" && url === "/v3/catalog/request")
      return send(res, 200, catalog);

    // 단건 조회
    if (method === "GET" && url.startsWith("/v3/assets/")) {
      const id = decodeURIComponent(url.split("/v3/assets/")[1]);
      const found = assets.find(a => a["@id"] === id);
      // 미존재 ID는 실제 EDC처럼 404. (과거 `?? assets[0]` 폴백이 항상 200을 줘서,
      //  프론트 자산ID 중복검사가 존재하지 않는 ID도 "이미 존재"로 오판하던 버그 방지.)
      if (!found) return send(res, 404, { message: `Asset not found: ${id}` });
      return send(res, 200, found);
    }
    if (method === "GET" && /\/v3\/edrs\/[^/]+\/dataaddress$/.test(url)) {
      return send(res, 200, {
        endpoint: "http://mock-edc:8090/data/sample",
        authorization: "Bearer demo-edr-token",
        type: "https://w3id.org/idsa/v4.1/HTTP",
      });
    }
    if (
      method === "GET" &&
      url.startsWith("/v3/contractnegotiations/") &&
      url.endsWith("/agreement")
    ) {
      return send(res, 200, {
        "@id": "agreement-001",
        assetId: "asset-pcf-battery-001",
        providerId: "BPNL000000000PRD",
        consumerId: "BPNL000000000CON",
      });
    }
    if (method === "GET" && url.startsWith("/v3/contractnegotiations/")) {
      const id = url.split("/v3/contractnegotiations/")[1];
      const found = negotiations.find(n => n["@id"] === id);
      if (!found)
        return send(res, 404, { message: `Negotiation not found: ${id}` });
      return send(res, 200, found);
    }
    if (method === "GET" && url.startsWith("/v3/transferprocesses/")) {
      const id = url.split("/v3/transferprocesses/")[1];
      const found = transfers.find(t => t["@id"] === id);
      if (!found)
        return send(res, 404, { message: `Transfer not found: ${id}` });
      return send(res, 200, found);
    }

    // 데이터 plane pull (transfer fetch)
    if (method === "GET" && url.startsWith("/data/")) {
      return send(res, 200, {
        sample: true,
        pcf: { co2e: 12.34, unit: "kg", asset: "demo" },
        generatedAt: new Date(now).toISOString(),
      });
    }

    // 헬스
    if (method === "GET" && (url === "/api/check/health" || url === "/health"))
      return send(res, 200, health);

    // Digital Twin Registry (DTR) — /semantics/registry/api/v3/*
    if (method === "GET" && /\/shell-descriptors$/.test(url)) {
      return send(res, 200, {
        result: dtrShells,
        paging_metadata: { cursor: null },
      });
    }
    if (method === "GET" && /\/shell-descriptors\/[^/]+$/.test(url)) {
      const raw = decodeURIComponent(url.split("/shell-descriptors/")[1]);
      let decoded = raw;
      try {
        decoded = Buffer.from(raw, "base64url").toString("utf8");
      } catch {
        /* keep raw */
      }
      return send(
        res,
        200,
        dtrShells.find(s => s.id === decoded) ?? dtrShells[0]
      );
    }
    if (method === "POST" && /\/lookup\/shells$/.test(url)) {
      return send(res, 200, { result: dtrShells.map(s => s.id) });
    }

    // IdentityHub Identity API — 참가자 자격증명 목록 (auth 미검사, 데모용)
    if (
      method === "GET" &&
      /\/api\/identity\/v1alpha\/participants\/[^/]+\/credentials$/.test(url)
    ) {
      return send(res, 200, ihCredentials);
    }

    // 쓰기/삭제/terminate 등 — 동작이 성공한 것처럼 generic 응답
    if (method === "POST" || method === "PUT" || method === "DELETE") {
      return send(res, 200, {
        "@id": `mock-${Date.now()}`,
        "@type": "IdResponse",
        createdAt: now,
      });
    }

    return send(res, 200, {});
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock-edc] EDC Management API mock listening on :${PORT}`);
});

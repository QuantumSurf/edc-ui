# Product

## Register

product

## Users

데이터스페이스(Catena-X 계열) 커넥터를 운영하는 엔지니어·운영자. 자산/정책/계약을 등록하고, 카탈로그를 조회하고, 협상·전송 상태를 모니터링한다. 데스크톱이 주 환경이지만 현장 확인용 모바일 사용도 있다. ID·URN·DID 같은 긴 기술 식별자를 일상적으로 다룬다.

## Product Purpose

Connector Hub — EDC(Eclipse Dataspace Connector) 플릿 관리 콘솔. 커넥터 등록부터 자산 제공(Asset → Policy → Offering), 데이터 교환(Catalog → Negotiation → Transfer → EDR), 디지털 트윈(DTR/SAMM), 시스템(Vault/IdentityHub/Audit)까지 단일 UI로 묶는다. 성공 = 운영자가 상태를 한눈에 파악하고 실수 없이 데이터 교환 플로우를 완료하는 것.

## Brand Personality

기술적 명료함(Technical Clarity). 신뢰·정확·밀도. 화려함보다 가독성과 일관성. 상태는 색·점·펄스로 즉시 식별된다. 폰트는 Inter 단일(모노스페이스 미사용 — 사용자 결정).

## Anti-references

- 마케팅 SaaS 랜딩 스타일(그라데이션, 히어로 메트릭, 과장 카피)
- 장식적 글래스모피즘·과한 모션
- fl-aggregator 디자인 시스템에서 벗어나는 독자 스타일 (fl-aggregator가 시각 기준: 흰 배경+점 배지, Inter 단일 폰트, 네이비 사이드바)

## Design Principles

1. **fl-aggregator 정합** — 모든 시각 결정은 fl-aggregator(`C:\Workspace\claude\fl-aggregator`)의 대응 패턴을 우선 따른다.
2. **상태 우선** — FSM 상태·헬스·진행을 색상 점 배지와 펄스로 즉시 읽히게 한다.
3. **식별자 표기** — ID/URN/DID/해시도 Inter로 렌더한다(`.mono` 클래스는 폰트가 아니라 tnum·크기 보정용). 구분은 크기·색·복사 버튼으로 한다.
4. **공용 컴포넌트 단일화** — ui-kmx.tsx의 프리미티브를 거치지 않은 일회성 스타일을 만들지 않는다.
5. **다이얼로그 중심 상세** — 행 상세·생성 플로우는 중앙 다이얼로그(또는 기존 SlidePanel)로, 페이지 이탈을 최소화한다.

## Accessibility & Inclusion

WCAG 2.1 AA. 본문 대비 ≥4.5:1, 키보드 포커스 가시화(focus-visible ring), aria-* 시맨틱, prefers-reduced-motion 대응, 한국어/영어 i18n(ko.ts/en.ts) 전 화면 적용.

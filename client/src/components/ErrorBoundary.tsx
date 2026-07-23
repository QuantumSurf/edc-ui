import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";
import { getTranslations, normalizeLocale } from "@/i18n";

interface Props {
  children: ReactNode;
  /**
   * fullscreen(기본): 앱 최상위 백스톱 — 화면 전체 에러 UI.
   * inline: 라우트 콘텐츠 영역용 — 셸(사이드바/탑바)을 유지한 채 콘텐츠만 에러 UI.
   */
  variant?: "fullscreen" | "inline";
  /**
   * 값이 바뀌면 에러 상태를 초기화한다. 라우트 이동 시 location 을 넘겨, 셸에서 다른
   * 라우트로 이동하면 콘텐츠 경계가 자동 복구되게 한다(에러 라우트에 갇히지 않도록).
   */
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: Props) {
    // 라우트가 바뀌면(resetKey 변경) 에러를 비워 새 라우트를 정상 렌더한다. 정상 이동
    // (에러 없음)에는 setState 하지 않으므로 매 네비게이션마다 재마운트되지 않는다.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      // 클래스 컴포넌트라 useI18n 훅 사용 불가 + ErrorBoundary 는 I18n Provider 바깥에 위치 →
      // App 과 동일한 localStorage "locale" 키로 활성 로케일을 직접 읽어 번역한다.
      // normalizeLocale + getTranslations 가드로 무효 locale 이어도 절대 undefined 가
      // 되지 않는다 — 최후 안전망인 이 폴백이 스스로 throw 해 흰 화면이 되는 것을 막는다.
      const locale = normalizeLocale(
        typeof localStorage !== "undefined"
          ? localStorage.getItem("locale")
          : null
      );
      const t = getTranslations(locale);
      const inline = this.props.variant === "inline";
      return (
        <div
          className={cn(
            "flex items-center justify-center bg-background",
            inline ? "py-20 px-4" : "min-h-screen p-8"
          )}
        >
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">{t.common.errorOccurred}</h2>

            {/* 스택 트레이스는 개발 환경에서만 노출 — 운영에서 내부 경로/구현 세부 정보 노출 방지 */}
            {import.meta.env.DEV && (
              <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
                <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                  {this.state.error?.stack}
                </pre>
              </div>
            )}

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              {t.common.reloadPage}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

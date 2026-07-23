import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installChunkReloadHandler } from "./lib/chunkReload";

// 배포/HMR 로 청크 해시가 바뀐 뒤 낡은 탭이 옛 청크를 preload 하다 실패하면 1회
// 새로고침으로 복구한다(lazy import 실패는 reloadableImport 가 따로 처리).
installChunkReloadHandler();

createRoot(document.getElementById("root")!).render(<App />);

// 조회 함수 진입점 — 모듈 적재로 등록부에 등록
import "./defect";
import "./equipment";
import "./material";
import "./production";

export { listQueries, runQuery, QueryParamError, type QueryOutput } from "./registry";

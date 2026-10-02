// 저장 보고서 목록 — 서버 목록(계정별 조회 범위) 적재, 화면 표시는 호출 측 소관
(function () {
  // 목록 적재 — 계정 미지정이면 서버 기본 계정 범위
  function load(accountId) {
    var path = 'reports' + (accountId ? '?account=' + encodeURIComponent(accountId) : '');
    return window.AlabApi.getJson(path).then(function (j) { return j.reports || []; });
  }

  window.AlabReports = { load: load };
})();

// 검증 루프 표기 공용 모듈 — 서버 오류 범주(tool_result errorKind·issues)·재지시 사유의 화면 표기, 대화창과 테스트 케이스 리포트 공용
(function () {
  var ERROR_KINDS = {
    bare_number: '참조 없는 숫자', char_limit: '글자 수 초과', ref: '참조 오류', unknown_key: '서식에 없는 키',
    format: '입력 형식 오류', template: '서식 오류', rule: '사용 조건 위반', report: '저장 오류',
    param: '조회 조건 오류', sql_guard: 'SQL 가드 거부', sql_error: 'SQL 실행 오류', catalog: '데이터 설명 조회 오류',
    unknown_tool: '제공하지 않는 도구'
  };
  var RETRIES = { max_tokens: '출력 한도 초과로 응답이 잘려 축약 재작성 지시', draft_missing: '초안 없이 종료하려 해 초안 작성 재지시' };

  function kind(k) { return ERROR_KINDS[k] || k || '오류'; }
  function retry(r) { return RETRIES[r] || r; }

  // 초안 검증 실패 내역 — 범주별 건수와 오류 위치, 범주 순서는 첫 등장 순
  function issueLines(ev) {
    var groups = {};
    var order = [];
    (ev.issues && ev.issues.length ? ev.issues : [{ at: '', kind: ev.errorKind }]).forEach(function (i) {
      if (!groups[i.kind]) { groups[i.kind] = []; order.push(i.kind); }
      if (i.at) groups[i.kind].push(i.at);
    });
    return order.map(function (k) {
      var at = groups[k];
      return '- ' + kind(k) + (at.length ? ' ' + at.length + '건 (' + at.join(', ') + ')' : '');
    });
  }

  window.AlabLoop = { kind: kind, retry: retry, issueLines: issueLines };
})();

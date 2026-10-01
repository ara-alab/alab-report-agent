// 샘플 계정 전환 — 서버 계정 목록을 읽어 타이틀바 계정 칩 메뉴로 선택, 선택값은 브라우저에 보관
(function () {
  var KEY = 'alab.account';
  var accounts = [];
  var current = null;
  var listeners = [];

  // 저장소 접근 — 차단·미지원 환경에선 기본 계정으로 동작
  function readSaved() {
    try { return window.localStorage.getItem(KEY); } catch { return null; }
  }
  function save(id) {
    try { window.localStorage.setItem(KEY, id); } catch { /* 보관 실패는 무시 */ }
  }

  function find(id) {
    for (var i = 0; i < accounts.length; i++) if (accounts[i].id === id) return accounts[i];
    return null;
  }

  function select(id) {
    var next = find(id);
    if (!next || (current && current.id === next.id)) return;
    var prev = current;
    current = next;
    save(next.id);
    listeners.forEach(function (fn) { fn(next, prev); });
  }

  // 계정 목록 적재 — 저장된 계정, 서버 기본 계정, 첫 계정 순으로 선택
  function load() {
    return window.AlabApi.getJson('accounts').then(function (j) {
      accounts = j.accounts || [];
      var pick = find(readSaved()) || find(j.defaultId) || accounts[0];
      if (pick) select(pick.id);
      return accounts;
    });
  }

  window.AlabAccount = {
    load: load,
    select: select,
    list: function () { return accounts.slice(); },
    current: function () { return current; },
    // 변경 알림 — 최초 적재 포함, prev 가 null 이면 최초 선택
    onChange: function (fn) { listeners.push(fn); }
  };
})();

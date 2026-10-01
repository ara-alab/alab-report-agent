// 서버 API 호출 공용 모듈 — 목업 페이지 기준 상대 경로라 배포 하위 경로와 무관
(function () {
  var BASE = '../api/';

  function url(path) {
    return BASE + String(path).replace(/^\/+/, '');
  }

  function fail(res) {
    return res.json().catch(function () { return {}; }).then(function (j) {
      var err = new Error(j.error || ('요청 실패 (' + res.status + ')'));
      err.status = res.status;
      err.code = j.code;
      throw err;
    });
  }

  function getJson(path) {
    return fetch(url(path), { cache: 'no-store' }).then(function (res) {
      return res.ok ? res.json() : fail(res);
    });
  }

  // NDJSON 스트림 호출 — 줄 단위 객체를 onLine 으로 전달, 끝나면 resolve
  function stream(path, body, onLine, signal) {
    return fetch(url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: signal
    }).then(function (res) {
      if (!res.ok) return fail(res);
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function flush(final) {
        var lines = buf.split('\n');
        buf = final ? '' : lines.pop();
        lines.forEach(function (l) {
          if (!l.trim()) return;
          var obj;
          try { obj = JSON.parse(l); } catch { throw new Error('응답 형식이 올바르지 않습니다.'); }
          onLine(obj);
        });
      }
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { buf += decoder.decode(); flush(true); return; }
          buf += decoder.decode(r.value, { stream: true });
          flush(false);
          return pump();
        });
      }
      // 해석·처리 실패 시 남은 스트림을 끊어 서버 연결을 놓아 줌
      return pump().catch(function (err) {
        reader.cancel().catch(function () { /* 이미 닫힌 스트림 */ });
        throw err;
      });
    });
  }

  window.AlabApi = { url: url, getJson: getJson, stream: stream };
})();

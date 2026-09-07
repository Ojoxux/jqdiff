/*
 * 移行後の実装。URL クエリ ?traps=1,3 で罠を個別に有効化する。
 * 罠を全部無効にした場合は app.jquery.js と完全に同じ振る舞いをしなければならない。
 */
(function () {
  var enabled = new Set(
    (new URLSearchParams(location.search).get('traps') || '')
      .split(',')
      .filter(Boolean)
      .map(Number)
  )
  var trap = function (n) { return enabled.has(n) }
  var $ = function (s) { return document.querySelector(s) }

  // 罠 1: 素朴な show() は元の display を復元できない
  $('[data-testid="toggle-badge"]').addEventListener('click', function () {
    var badge = $('#badge')
    if (getComputedStyle(badge).display === 'none') {
      if (trap(1)) badge.style.display = 'block'
      else badge.style.removeProperty('display')
    } else {
      badge.style.display = 'none'
    }
  })

  // 罠 2: return false は preventDefault と stopPropagation の両方
  $('#outer').addEventListener('click', function () {
    $('#bubble-log').textContent = 'outer clicked'
  })
  $('#inner-link').addEventListener('click', function (e) {
    e.preventDefault()
    if (!trap(2)) e.stopPropagation()
  })

  // 罠 3: $.ajax のデフォルト(form-urlencoded + X-Requested-With)が消える
  $('#save-form').addEventListener('submit', function (e) {
    e.preventDefault()
    var title = document.querySelector('input[name=title]').value
    var request = trap(3)
      ? fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title })
        })
      : fetch('/api/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: new URLSearchParams({ title: title }).toString()
        })
    request.then(function (res) {
      if (res.ok) $('#save-result').textContent = 'saved'
    })
  })

  // 罠 4: fetch は 4xx/5xx で reject しない
  $('[data-testid="fail-btn"]').addEventListener('click', function () {
    var request = fetch('/api/fail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
    if (trap(4)) {
      request.catch(function () { $('#error-box').textContent = 'failed' })
    } else {
      request.then(function (res) {
        if (!res.ok) $('#error-box').textContent = 'failed'
      })
    }
  })

  // 罠 5: .css() の数値は px が補われるが style.width は補われない
  $('[data-testid="widen-btn"]').addEventListener('click', function () {
    if (trap(5)) $('#bar').style.width = 300
    else $('#bar').style.width = '300px'
  })

  // 罠 6: jQuery は 0 件でも no-op、querySelector は null を返す
  $('[data-testid="missing-btn"]').addEventListener('click', function () {
    if (trap(6)) {
      document.querySelector('.does-not-exist').classList.add('marked')
    } else {
      var el = document.querySelector('.does-not-exist')
      if (el) el.classList.add('marked')
    }
    $('#after-missing').textContent = 'updated'
  })

  // 罠 7: 委譲ハンドラの登録順が入れ替わる
  var appendLog = function (ch) {
    return function (e) {
      if (e.target.closest('li')) $('#order-log').textContent += ch
    }
  }
  if (trap(7)) {
    $('#list').addEventListener('click', appendLog('B'))
    $('#list').addEventListener('click', appendLog('A'))
  } else {
    $('#list').addEventListener('click', appendLog('A'))
    $('#list').addEventListener('click', appendLog('B'))
  }

  // 罠 8: .html() は script を実行するが innerHTML は実行しない
  $('[data-testid="inject-btn"]').addEventListener('click', function () {
    var html =
      '<span class="injected">x</span>' +
      '<script>document.getElementById("inject-target").setAttribute("data-script-ran","1")<\/script>'
    var target = $('#inject-target')
    target.innerHTML = html
    if (!trap(8)) {
      // innerHTML で挿入された script は実行されないので作り直す
      target.querySelectorAll('script').forEach(function (old) {
        var fresh = document.createElement('script')
        fresh.textContent = old.textContent
        old.replaceWith(fresh)
      })
    }
  })
})()

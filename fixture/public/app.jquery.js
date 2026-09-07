/* 移行前の実装。ここでの挙動が仕様そのものになる。 */
(function () {
  $('[data-testid="toggle-badge"]').on('click', function () {
    $('#badge').toggle()
  })

  $('#outer').on('click', function () {
    $('#bubble-log').text('outer clicked')
  })
  $('#inner-link').on('click', function () {
    return false
  })

  $('#save-form').on('submit', function (e) {
    e.preventDefault()
    $.ajax({
      url: '/api/save',
      method: 'POST',
      data: { title: $('input[name=title]').val() }
    }).done(function () {
      $('#save-result').text('saved')
    })
  })

  $('[data-testid="fail-btn"]').on('click', function () {
    $.ajax({ url: '/api/fail', method: 'POST' }).fail(function () {
      $('#error-box').text('failed')
    })
  })

  $('[data-testid="widen-btn"]').on('click', function () {
    $('#bar').css('width', 300)
  })

  $('[data-testid="missing-btn"]').on('click', function () {
    $('.does-not-exist').addClass('marked')
    $('#after-missing').text('updated')
  })

  $('#list').on('click', 'li', function () {
    $('#order-log').text($('#order-log').text() + 'A')
  })
  $('#list').on('click', 'li', function () {
    $('#order-log').text($('#order-log').text() + 'B')
  })

  $('[data-testid="inject-btn"]').on('click', function () {
    $('#inject-target').html(
      '<span class="injected">x</span>' +
      '<script>document.getElementById("inject-target").setAttribute("data-script-ran","1")<\/script>'
    )
  })
})()

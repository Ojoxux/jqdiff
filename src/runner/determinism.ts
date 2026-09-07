/**
 * ページに注入して非決定性を潰すスクリプト。
 * setTimeout と requestAnimationFrame は実時間のまま動かす。
 * アニメーションの完了を待つ必要があるため、ここを止めると逆に差分が安定しない。
 */
export function determinismScript(seed = 1): string {
  return `(() => {
  let s = ${seed};
  Math.random = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };

  const FIXED = new Date('2026-01-01T00:00:00.000Z').getTime();
  const OrigDate = Date;
  class StubDate extends OrigDate {
    constructor(...args) {
      if (args.length === 0) super(FIXED);
      else super(...args);
    }
    static now() { return FIXED; }
  }
  window.Date = StubDate;

  if (window.crypto) {
    let n = 0;
    window.crypto.randomUUID = () => {
      n += 1;
      return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
    };
  }
})();`
}

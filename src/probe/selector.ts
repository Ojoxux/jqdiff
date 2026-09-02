export function isGenerated(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value))
}

function escapeIdent(v: string): string {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } }
  if (typeof g.CSS?.escape === 'function') return g.CSS.escape(v)
  return v.replace(/([^a-zA-Z0-9_-])/g, '\\$1')
}

function escapeAttrValue(v: string): string {
  return v.replace(/(["\\])/g, '\\$1')
}

/** 要素を一意に指すセレクタ文字列を作る。 */
export function buildSelector(el: Element, generatedIdPatterns: RegExp[]): string {
  const doc = el.ownerDocument
  const unique = (s: string): boolean => {
    try {
      const found = doc.querySelectorAll(s)
      return found.length === 1 && found[0] === el
    } catch {
      return false
    }
  }

  const testId = el.getAttribute('data-testid')
  if (testId) {
    const s = `[data-testid="${escapeAttrValue(testId)}"]`
    if (unique(s)) return s
  }

  const id = el.getAttribute('id')
  if (id && !isGenerated(id, generatedIdPatterns)) {
    const s = `#${escapeIdent(id)}`
    if (unique(s)) return s
  }

  const name = el.getAttribute('name')
  if (name) {
    const s = `${el.tagName.toLowerCase()}[name="${escapeAttrValue(name)}"]`
    if (unique(s)) return s
  }

  return structuralPath(el, generatedIdPatterns)
}

function structuralPath(el: Element, patterns: RegExp[]): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur) {
    const tag = cur.tagName.toLowerCase()
    parts.unshift(segment(cur, patterns))
    // ルートまで来たら打ち切る。html を無条件に落とすと、
    // html 自身を指すときにセレクタが空文字になる。
    if (tag === 'body' || tag === 'html') break
    cur = cur.parentElement
  }
  return parts.join(' > ')
}

function segment(el: Element, patterns: RegExp[]): string {
  const tag = el.tagName.toLowerCase()
  if (tag === 'body' || tag === 'html') return tag

  const classes = Array.from(el.classList)
    .filter((c) => !isGenerated(c, patterns))
    .sort()
  let s = tag + classes.map((c) => `.${escapeIdent(c)}`).join('')

  // 条件付きではなく常に付ける。分岐が減って決定的になる。
  const parent = el.parentElement
  if (parent) {
    const index = Array.prototype.indexOf.call(parent.children, el) + 1
    s += `:nth-child(${index})`
  }
  return s
}

/** 要素が既に外れている場合など、セレクタが作れないノードの記述子。 */
export function describeNode(node: Node, patterns: RegExp[]): string {
  if (node.nodeType === 1) {
    const el = node as Element
    const classes = Array.from(el.classList)
      .filter((c) => !isGenerated(c, patterns))
      .sort()
    return el.tagName.toLowerCase() + classes.map((c) => `.${c}`).join('')
  }
  if (node.nodeType === 3) {
    return `#text:"${(node.textContent ?? '').trim()}"`
  }
  return `#node(${node.nodeType})`
}

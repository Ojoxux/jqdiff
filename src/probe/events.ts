import type { EventEntry } from '../types.js'
import { buildSelector } from './selector.js'
import type { ProbeState } from './state.js'

const INTERNAL = '__jqdiffInternal'

/** probe / recorder 自身のリスナーに印をつける。記録対象から外れる。 */
export function markInternal<T extends EventListenerOrEventListenerObject>(listener: T): T {
  ;(listener as unknown as Record<string, boolean>)[INTERNAL] = true
  return listener
}

function isInternal(listener: EventListenerOrEventListenerObject): boolean {
  return (listener as unknown as Record<string, boolean>)[INTERNAL] === true
}

function describeTarget(target: EventTarget | null, patterns: RegExp[]): string {
  if (!target) return '#null'
  if (typeof Element !== 'undefined' && target instanceof Element) {
    return buildSelector(target, patterns)
  }
  if (typeof Document !== 'undefined' && target instanceof Document) return '#document'
  return '#window'
}

function phaseOf(phase: number): EventEntry['phase'] {
  if (phase === 1) return 'capture'
  if (phase === 2) return 'target'
  return 'bubble'
}

function makeWrapper(
  state: ProbeState,
  listener: EventListenerOrEventListenerObject,
): EventListener {
  const patterns = state.config.generatedIdPatterns

  return function (this: EventTarget, event: Event) {
    const before = event.defaultPrevented
    let stopped = false

    const origStop = event.stopPropagation.bind(event)
    const origStopImmediate = event.stopImmediatePropagation.bind(event)

    // event オブジェクトの own property として一時的に差し替える。
    // 元の実装には必ず委譲するので、伝播の挙動そのものは変わらない。
    Object.defineProperty(event, 'stopPropagation', {
      configurable: true,
      writable: true,
      value: () => {
        stopped = true
        origStop()
      },
    })
    Object.defineProperty(event, 'stopImmediatePropagation', {
      configurable: true,
      writable: true,
      value: () => {
        stopped = true
        origStopImmediate()
      },
    })

    const currentTarget = describeTarget(this, patterns)
    const target = describeTarget(event.target, patterns)
    const phase = phaseOf(event.eventPhase)

    try {
      if (typeof listener === 'function') return listener.call(this, event)
      return listener.handleEvent.call(listener, event)
    } finally {
      delete (event as unknown as Record<string, unknown>).stopPropagation
      delete (event as unknown as Record<string, unknown>).stopImmediatePropagation

      state.pendingEvents.push({
        type: event.type,
        target,
        currentTarget,
        phase,
        defaultPreventedBefore: before,
        defaultPreventedAfter: event.defaultPrevented,
        propagationStoppedAfter: stopped,
      })
    }
  }
}

/** addEventListener / removeEventListener をラップする。戻り値を呼ぶと元に戻す。 */
export function installEventRecorder(state: ProbeState): () => void {
  const proto = EventTarget.prototype
  const origAdd = proto.addEventListener
  const origRemove = proto.removeEventListener

  // 元のリスナー → (type|capture → ラッパ) の対応。
  // これが無いと removeEventListener が効かなくなり、jQuery の .off() を壊す。
  const registry = new WeakMap<object, Map<string, EventListener>>()

  const captureOf = (options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean =>
    typeof options === 'boolean' ? options : Boolean(options?.capture)

  proto.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (!listener || isInternal(listener)) {
      return origAdd.call(this, type, listener, options)
    }

    const key = `${type}|${captureOf(options)}`
    let per = registry.get(listener as object)
    if (!per) {
      per = new Map()
      registry.set(listener as object, per)
    }
    let wrapped = per.get(key)
    if (!wrapped) {
      wrapped = makeWrapper(state, listener)
      per.set(key, wrapped)
    }

    return origAdd.call(this, type, wrapped, options)
  }

  proto.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (!listener || isInternal(listener)) {
      return origRemove.call(this, type, listener, options)
    }
    const wrapped = registry.get(listener as object)?.get(`${type}|${captureOf(options)}`)
    return origRemove.call(this, type, wrapped ?? listener, options)
  }

  return () => {
    proto.addEventListener = origAdd
    proto.removeEventListener = origRemove
  }
}

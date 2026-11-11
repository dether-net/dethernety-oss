/**
 * The installer's questions, on a terminal: numbered choices and short answers,
 * through Node's own readline. Every answer has a flag, so nothing here is
 * needed off a terminal. Ctrl-C or the end of input aborts the whole command
 * before anything is written.
 */
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export class PromptAborted extends Error {
  constructor() {
    super('aborted')
    this.name = 'PromptAborted'
  }
}

export interface Choice<T extends string> {
  value: T
  label: string
}

export interface Prompter {
  select<T extends string>(question: string, choices: ReadonlyArray<Choice<T>>, fallback: T): Promise<T>
  multi<T extends string>(question: string, choices: ReadonlyArray<Choice<T>>, preselected: readonly T[]): Promise<T[]>
  text(question: string, fallback: string): Promise<string>
  confirm(question: string): Promise<boolean>
  close(): void
}

export function readlinePrompter(input: Readable, output: Writable): Prompter {
  const rl = createInterface({ input, terminal: false })
  // Every line is queued as it arrives: an answer typed (or piped) before its question is kept, in order.
  const lines: string[] = []
  let closed = false
  let waiting: (() => void) | null = null
  rl.on('line', (l) => { lines.push(l); waiting?.() })
  rl.on('close', () => { closed = true; waiting?.() })
  const ask = async (q: string): Promise<string> => {
    output.write(q)
    while (!lines.length) {
      if (closed) throw new PromptAborted()
      await new Promise<void>((r) => { waiting = r })
      waiting = null
    }
    return lines.shift()!.trim()
  }
  const list = <T extends string>(choices: ReadonlyArray<Choice<T>>, marked: (v: T) => boolean) =>
    choices.map((c, i) => `  ${i + 1}) ${c.label}${marked(c.value) ? ' *' : ''}`).join('\n')
  return {
    async select(question, choices, fallback) {
      for (;;) {
        const a = await ask(`${question}\n${list(choices, (v) => v === fallback)}\n> `)
        if (a === '') return fallback
        const n = Number(a)
        if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1]!.value
        output.write('Answer with one of the numbers.\n')
      }
    },
    async multi(question, choices, preselected) {
      for (;;) {
        const a = await ask(`${question} (numbers, comma-separated; Enter keeps the marked ones)\n${list(choices, (v) => preselected.includes(v))}\n> `)
        if (a === '' && preselected.length) return [...preselected]
        const picks = a.split(',').map((s) => Number(s.trim()))
        if (picks.length && picks.every((n) => Number.isInteger(n) && n >= 1 && n <= choices.length)) return [...new Set(picks.map((n) => choices[n - 1]!.value))]
        output.write('Answer with one or more of the numbers.\n')
      }
    },
    async text(question, fallback) {
      const a = await ask(`${question}${fallback ? ` [${fallback}]` : ''}\n> `)
      return a === '' ? fallback : a
    },
    async confirm(question) {
      const a = (await ask(`${question} (yes/no)\n> `)).toLowerCase()
      return a === 'y' || a === 'yes'
    },
    close() {
      rl.close()
    },
  }
}

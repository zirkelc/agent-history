/**
 * Finds secrets in exported text and replaces each one with `[REDACTED:<kind>]`.
 *
 * The text is the file as it is written: JSONL with its JSON escapes, or
 * Markdown. No pattern takes a `"` or a `\`, except the private key block,
 * which starts and ends on plain characters; so a redacted JSONL line is still
 * valid JSON.
 */

export type Redaction = {
  text: string
  // How many secrets were replaced.
  count: number
}

type Rule = {
  kind: string
  pattern: RegExp
  // The capture group that holds the secret; the whole match when absent.
  group?: number
  // A last check on the secret, for patterns that also match harmless text.
  isSecret?: (value: string) => boolean
}

// Known token formats first, so the generic rules do not take their names.
const RULES: ReadonlyArray<Rule> = [
  { kind: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, isSecret: hasLetterAndDigit },
  { kind: 'github', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { kind: 'aws', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { kind: 'google', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'stripe', pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'slack', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
  { kind: 'npm', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { kind: 'bearer', pattern: /(\bBearer\s+)([A-Za-z0-9._~+/-]{20,}=*)/g, group: 2 },
  {
    kind: 'url-password',
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'\\]+:)([^\s@/"'\\]{3,})(@)/g,
    group: 2,
    isSecret: value => !isPlaceholder(value),
  },
  {
    kind: 'assignment',
    pattern:
      /(\b[A-Za-z0-9_-]*(?:api[_-]?key|secret|token|passw(?:or)?d|credential)[A-Za-z0-9_-]*(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)([^\s"'\\,;`)}\]]{12,})/gi,
    group: 2,
    isSecret: value => hasLetterAndDigit(value) && !isPlaceholder(value),
  },
]

const REDACTED = /^\[REDACTED:/

export function redactSecrets(text: string): Redaction {
  let count = 0
  let result = text
  for (const rule of RULES) {
    result = result.replace(rule.pattern, (match: string, ...groups: Array<unknown>) => {
      const secret = rule.group === undefined ? match : String(groups[rule.group - 1] ?? '')
      if (REDACTED.test(secret) || (rule.isSecret && !rule.isSecret(secret))) return match
      count += 1
      const label = `[REDACTED:${rule.kind}]`
      if (rule.group === undefined) return label
      const before = groups.slice(0, rule.group - 1).join('')
      const after = groups.slice(rule.group, groups.length - 2).filter(part => typeof part === 'string').join('')
      return `${before}${label}${after}`
    })
  }
  return { text: result, count }
}

function hasLetterAndDigit(value: string): boolean {
  return /[A-Za-z]/.test(value) && /\d/.test(value)
}

// Values that stand for a secret in docs and code, not a secret itself.
function isPlaceholder(value: string): boolean {
  return /^(?:\$\{?|<|\*{3,}|x{4,}|\.{3})|process\.env|REDACTED/i.test(value)
}

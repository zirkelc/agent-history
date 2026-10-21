import { describe, expect, test } from 'claude-code/testing'

import { redactSecrets } from '../hooks/redact'

// Fake secrets, put together at run time so that no scanner takes this file for a leak.
const FAKE = {
  anthropic: 'sk-' + 'ant-api03-' + 'Ab1'.repeat(10),
  openai: 'sk-' + 'proj-' + 'Cd2'.repeat(10),
  github: 'gh' + 'p_' + 'Ef3'.repeat(12),
  aws: 'AK' + 'IA' + 'ABCD2345EFGH6789',
  google: 'AI' + 'za' + 'Gh4'.repeat(11) + 'xy',
  stripe: 'sk' + '_live_' + 'Ij5'.repeat(8),
  slack: 'xo' + 'xb-' + '1234567890-abcdefghij',
  jwt: 'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'ey' + 'JzdWIiOiIxMjM0NTYifQ.' + 'Kl6'.repeat(8),
  password: 'Pa55' + 'word' + 'Mn7Op8',
}

describe('redact', () => {
  test('replaces each known token format with its kind', () => {
    // Arrange
    const text = [FAKE.anthropic, FAKE.openai, FAKE.github, FAKE.aws, FAKE.google, FAKE.stripe, FAKE.slack, FAKE.jwt].join(' ')

    // Act
    const result = redactSecrets(text)

    // Assert
    expect(result.text).toBe(
      '[REDACTED:anthropic] [REDACTED:openai] [REDACTED:github] [REDACTED:aws] [REDACTED:google] [REDACTED:stripe] [REDACTED:slack] [REDACTED:jwt]',
    )
    expect(result.count).toBe(8)
  })

  test('keeps the name of an assignment, a bearer header and a URL, and takes out only the secret', () => {
    // Arrange
    const text = [
      `API_KEY=${FAKE.password}`,
      `Authorization: Bearer ${'Qr9'.repeat(10)}`,
      `postgres://admin:${FAKE.password}@db.example.com/app`,
    ].join('\n')

    // Act
    const result = redactSecrets(text)

    // Assert
    expect(result.text).toBe(
      ['API_KEY=[REDACTED:assignment]', 'Authorization: Bearer [REDACTED:bearer]', 'postgres://admin:[REDACTED:url-password]@db.example.com/app'].join('\n'),
    )
  })

  test('a redacted JSONL line is still valid JSON', () => {
    // Arrange
    const key = `-----BEGIN RSA PRIVATE KEY-----\nMIIEow${'Ab1'.repeat(20)}\n-----END RSA PRIVATE KEY-----`
    const content = `config: {"token": "${FAKE.password}"}\n${key}\nkey ${FAKE.github}`
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content } })

    // Act
    const result = redactSecrets(line)

    // Assert
    const parsed = JSON.parse(result.text)
    expect(parsed.message.content).toBe('config: {"token": "[REDACTED:assignment]"}\n[REDACTED:private-key]\nkey [REDACTED:github]')
    expect(result.count).toBe(3)
  })

  test('leaves ids, hashes, usage counts and placeholders as they are', () => {
    // Arrange
    const text = [
      'session 54c86570-837f-4e9b-b43a-865a41f6fc2d at commit 9d2ca1f4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c0',
      '{"usage":{"input_tokens":12345,"output_tokens":678,"cache_read_input_tokens":90000}}',
      'token: string',
      'const apiKey = process.env.ANTHROPIC_API_KEY',
      'password=${DATABASE_PASSWORD}',
      'API_KEY=<your-api-key-here>',
      'Set the secret in the dashboard, then rotate the token.',
    ].join('\n')

    // Act
    const result = redactSecrets(text)

    // Assert
    expect(result.text).toBe(text)
    expect(result.count).toBe(0)
  })

  test('redacting twice changes nothing more', () => {
    // Arrange
    const once = redactSecrets(`API_KEY=${FAKE.password} ${FAKE.anthropic}`).text

    // Act
    const twice = redactSecrets(once)

    // Assert
    expect(twice.text).toBe(once)
    expect(twice.count).toBe(0)
  })
})

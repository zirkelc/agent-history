import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import type { Config } from '../claude-code/hooks/config'
import { commit, push } from '../claude-code/hooks/git'
import { createSync } from '../claude-code/hooks/sync'
import { commitAll, line, machines, nodeHost, readFile, sh, writeFile, writeSession } from './fixtures/repos'

const STATE = { isRepo: true, remote: 'origin', branch: 'main' }

function configOf(exportDir: string): Config {
  return {
    exportDir,
    formats: ['jsonl', 'markdown'],
    filters: { text: true, toolUse: true, toolInput: false, toolResults: false, thinking: false, meta: false },
    redactSecrets: true,
    autoPush: true,
    commitDelayMs: 60_000,
  }
}

describe('push behind the remote', () => {
  test('a commit of another session during the merge leaves the branch, the index and the work tree consistent', async () => {
    // Arrange
    const { remote, a, b } = machines()
    writeFile(join(b, 'sessions/r/r.jsonl'), line('r-1'))
    commitAll(b, 'sync: r')
    sh(b, 'push', '--quiet')
    writeFile(join(a, 'sessions/a/a.jsonl'), line('a-1'))
    commitAll(a, 'sync: a')
    let isInjected = false
    const other = nodeHost()
    const host = nodeHost({
      beforeRun: async argv => {
        if (isInjected || argv[1] !== 'update-ref' || argv[2] !== 'refs/heads/main') return
        isInjected = true
        writeFile(join(a, 'sessions/b/b.jsonl'), line('b-1'))
        await commit(other, a, ['sessions/b'], 'sync: b')
      },
    })

    // Act
    const first = await push(host, a, STATE).then(
      () => undefined,
      (error: unknown) => error,
    )
    const status = sh(a, 'status', '--porcelain')
    await push(host, a, STATE)

    // Assert
    expect(isInjected).toBe(true)
    expect(first).toBeInstanceOf(Error)
    expect(status).toBe('')
    expect(sh(a, 'status', '--porcelain')).toBe('')
    expect(sh(a, 'log', '--format=%s', 'HEAD')).toContain('sync: b')
    expect(sh(a, 'log', '--format=%s', 'HEAD')).toContain('sync: r')
    expect(sh(a, 'rev-parse', 'HEAD')).toBe(sh(remote, 'rev-parse', 'main'))
    expect(readFile(join(a, 'sessions/r/r.jsonl'))).toBe(line('r-1'))
  })

  for (const longer of ['remote', 'local'] as const) {
    test(`a session exported on both machines takes the longer transcript (${longer} longer)`, async () => {
      // Arrange
      const { remote, a, b } = machines()
      writeSession(a, 's1', ['u1', 'u2'])
      commitAll(a, 'sync: s1')
      sh(a, 'push', '--quiet')
      sh(b, 'pull', '--quiet')
      const short = ['u1', 'u2', 'u3']
      const long = ['u1', 'u2', 'u3', 'u4', 'u5']
      writeSession(b, 's1', longer === 'remote' ? long : short)
      commitAll(b, 'sync: s1 on b')
      sh(b, 'push', '--quiet')
      writeSession(a, 's1', longer === 'remote' ? short : long)
      commitAll(a, 'sync: s1 on a')

      // Act
      await push(nodeHost(), a, STATE)

      // Assert
      const remoteFile = (name: string) => sh(remote, 'show', `main:sessions/s1/${name}`)
      expect(remoteFile('s1.jsonl')).toBe(long.map(line).join('').trim())
      expect(remoteFile('s1.md')).toBe(long.map(uuid => `## ${uuid}\n`).join('\n').trim())
      expect(JSON.parse(remoteFile('s1.meta.json')).turns).toBe(5)
      expect(sh(remote, 'rev-list', '--parents', '-n', '1', 'main').split(' ').length).toBe(3)
      expect(sh(a, 'rev-parse', 'HEAD')).toBe(sh(remote, 'rev-parse', 'main'))
      expect(sh(a, 'status', '--porcelain')).toBe('')
      expect(readFile(join(a, 'sessions/s1/s1.jsonl'))).toBe(long.map(line).join(''))
    })
  }

  test('a session whose shorter transcript has an entry the longer one lacks is not merged', async () => {
    // Arrange
    const { remote, a, b } = machines()
    writeSession(a, 's1', ['u1'])
    commitAll(a, 'sync: s1')
    sh(a, 'push', '--quiet')
    sh(b, 'pull', '--quiet')
    writeSession(b, 's1', ['u1', 'u2', 'u3'])
    commitAll(b, 'sync: s1 on b')
    sh(b, 'push', '--quiet')
    writeSession(a, 's1', ['u1', 'x2'])
    commitAll(a, 'sync: s1 on a')
    const before = sh(remote, 'rev-parse', 'main')

    // Act
    const result = push(nodeHost(), a, STATE)

    // Assert
    await expect(result).rejects.toThrow()
    expect(sh(remote, 'rev-parse', 'main')).toBe(before)
    expect(sh(a, 'status', '--porcelain')).toBe('')
  })

  test('a conflict outside the session folders is not merged', async () => {
    // Arrange
    const { remote, a, b } = machines()
    writeFile(join(b, 'notes.md'), 'b\n')
    commitAll(b, 'notes on b')
    sh(b, 'push', '--quiet')
    writeFile(join(a, 'notes.md'), 'a\n')
    commitAll(a, 'notes on a')
    const before = sh(remote, 'rev-parse', 'main')

    // Act
    const result = push(nodeHost(), a, STATE)

    // Assert
    await expect(result).rejects.toThrow()
    expect(sh(remote, 'rev-parse', 'main')).toBe(before)
  })
})

describe('sync', () => {
  test('a sync of one session does not commit the changed files of another session', async () => {
    // Arrange
    const { a } = machines()
    sh(a, 'remote', 'remove', 'origin')
    writeSession(a, 'session-a', ['a1'])
    writeSession(a, 'session-b', ['b1'])
    const host = nodeHost({ pending: ['session-a'] })
    const sync = createSync(host, configOf(a))

    // Act
    await sync.syncNow()

    // Assert
    const committed = sh(a, 'show', '--name-only', '--format=', 'HEAD').split('\n')
    expect(committed).toEqual(['sessions/session-a/session-a.jsonl', 'sessions/session-a/session-a.md', 'sessions/session-a/session-a.meta.json'])
    expect(sh(a, 'status', '--porcelain')).toBe('?? sessions/session-b/')
    expect(host.statusValue().pending).toEqual([])
  })
})

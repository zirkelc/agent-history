import { describe, expect, test } from 'claude-code/testing'

import { rowsOf } from '../hooks/pane-view'

describe('pane view', () => {
  test('a long warning is cut into rows of the width, the last one marked', () => {
    // Arrange
    const text = 'abcdefghij'

    // Act
    const rows = rowsOf(text, 4, 2)

    // Assert
    expect(rows).toEqual(['abcd', 'efg…'])
  })

  test('a short warning keeps its rows', () => {
    // Arrange
    const text = 'abcdef'

    // Act
    const rows = rowsOf(text, 4, 3)

    // Assert
    expect(rows).toEqual(['abcd', 'ef'])
  })
})

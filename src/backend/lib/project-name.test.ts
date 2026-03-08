import { describe, it, expect } from 'vitest'
import { sanitizeProjectName } from './project-name.js'

describe('sanitizeProjectName', () => {
  it('preserves ASCII alphanumeric characters unchanged', () => {
    expect(sanitizeProjectName('MyProject123')).toBe('MyProject123')
  })

  it('preserves Cyrillic characters including spaces', () => {
    // Spaces and Cyrillic letters are both allowed in filenames
    expect(sanitizeProjectName('Мой проект')).toBe('Мой проект')
    expect(sanitizeProjectName('МойПроект')).toBe('МойПроект')
  })

  it('preserves spaces in ASCII names', () => {
    expect(sanitizeProjectName('My Project')).toBe('My Project')
  })

  it('replaces filesystem-unsafe characters with underscores', () => {
    expect(sanitizeProjectName('a/b\\c:d*e?f"g<h>i|j')).not.toMatch(/[/\\:*?"<>|]/)
  })

  it('preserves hyphens, underscores, and dots', () => {
    expect(sanitizeProjectName('my-project_v1.0')).toBe('my-project_v1.0')
  })

  it('preserves CJK characters', () => {
    expect(sanitizeProjectName('我的项目')).toBe('我的项目')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsCategory, NewsItem, NewsView } from '@/api'
import { isNew, loadSeen, newIds, saveSeen } from '@/news'
import { memoryStorage } from './memory-storage'

const cats: NewsCategory[] = [{ key: 'announcement', label: 'Announcements', group: 'posts', enabled: true, since: '2026-11-05' }]
const post = (id: string, date: string): NewsItem => ({
  id,
  category: 'announcement',
  group: 'posts',
  title: id,
  summary: '',
  date,
  url: `https://dether.net/${id}`,
  tags: [],
  notify: false,
})

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
afterEach(() => vi.unstubAllGlobals())

describe('news read state', () => {
  it('counts an item from the day its category was switched on, and nothing before it', () => {
    expect(isNew(post('a', '2026-11-05'), cats, new Set())).toBe(true)
    expect(isNew(post('b', '2026-11-04'), cats, new Set())).toBe(false)
    expect(isNew(post('a', '2026-11-05'), cats, new Set(['a']))).toBe(false)
  })

  it('counts nothing from a feed that was not read', () => {
    const view: NewsView = { status: 'unavailable', categories: cats, items: [post('a', '2026-11-06')] }
    expect(newIds(view, new Set())).toEqual([])
    expect(newIds(null, new Set())).toEqual([])
  })

  it('remembers only the ids the feed still carries', () => {
    saveSeen(new Set(['a', 'gone']), ['a', 'b'])
    expect([...loadSeen()]).toEqual(['a'])
  })

  it('starts again from a damaged entry, or from storage it cannot use', () => {
    localStorage.setItem('console_news_seen', '{not json')
    expect(loadSeen().size).toBe(0)
    localStorage.setItem('console_news_seen', JSON.stringify(['a', 7, null]))
    expect([...loadSeen()]).toEqual(['a'])
    vi.stubGlobal('localStorage', undefined)
    expect(loadSeen().size).toBe(0)
    expect(() => saveSeen(new Set(['a']), ['a'])).not.toThrow()
  })
})

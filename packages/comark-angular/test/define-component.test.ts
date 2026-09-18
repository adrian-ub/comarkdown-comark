import { describe, expect, it } from 'vitest'
import type { ValueProvider } from '@angular/core'
import { defineMarkdownComponent, defineMarkdownDocumentComponent } from '../src/define.ts'
import { MARKDOWN_CONFIG, MARKDOWN_DOCUMENT_CONFIG } from '../src/config.ts'

describe('defineMarkdownComponent', () => {
  it('returns a provider for MARKDOWN_CONFIG', () => {
    const provider = defineMarkdownComponent({}) as ValueProvider
    expect(provider).toBeDefined()
    expect(provider.provide).toBe(MARKDOWN_CONFIG)
    expect(provider.useValue).toBeDefined()
  })

  it('returns a provider for MARKDOWN_CONFIG with default config', () => {
    const provider = defineMarkdownComponent() as ValueProvider
    expect(provider).toBeDefined()
    expect(provider.provide).toBe(MARKDOWN_CONFIG)
    expect(provider.useValue).toBeDefined()
  })

  it('passes through plugins in useValue', () => {
    const fakePlugin = { name: 'test', setup: () => {} }
    const provider = defineMarkdownComponent({
      plugins: [fakePlugin as any],
    }) as ValueProvider
    expect(provider.useValue?.plugins).toEqual([fakePlugin])
  })

  it('passes through components in useValue', () => {
    class FakeComponent {}
    const provider = defineMarkdownComponent({
      components: { alert: FakeComponent as any },
    }) as ValueProvider
    expect(provider.useValue?.components).toEqual({ alert: FakeComponent })
  })

  it('passes through class in useValue', () => {
    const provider = defineMarkdownComponent({
      class: 'prose dark:prose-invert',
    }) as ValueProvider
    expect(provider.useValue?.class).toBe('prose dark:prose-invert')
  })

  it('passes through parse options in useValue', () => {
    const provider = defineMarkdownComponent({
      autoClose: true,
      linkify: true,
    }) as ValueProvider
    expect(provider.useValue?.options).toEqual({ autoClose: true, linkify: true })
  })
})

describe('defineMarkdownDocumentComponent', () => {
  it('returns a provider for MARKDOWN_DOCUMENT_CONFIG', () => {
    const provider = defineMarkdownDocumentComponent({}) as ValueProvider
    expect(provider).toBeDefined()
    expect(provider.provide).toBe(MARKDOWN_DOCUMENT_CONFIG)
    expect(provider.useValue).toBeDefined()
  })

  it('returns a provider for MARKDOWN_DOCUMENT_CONFIG with default config', () => {
    const provider = defineMarkdownDocumentComponent() as ValueProvider
    expect(provider).toBeDefined()
    expect(provider.provide).toBe(MARKDOWN_DOCUMENT_CONFIG)
    expect(provider.useValue).toBeDefined()
  })

  it('passes through components in useValue', () => {
    class FakeComponent {}
    const provider = defineMarkdownDocumentComponent({
      components: { Math: FakeComponent as any },
    }) as ValueProvider
    expect(provider.useValue?.components).toEqual({ Math: FakeComponent })
  })

  it('passes through class in useValue', () => {
    const provider = defineMarkdownDocumentComponent({
      class: 'prose',
    }) as ValueProvider
    expect(provider.useValue?.class).toBe('prose')
  })
})

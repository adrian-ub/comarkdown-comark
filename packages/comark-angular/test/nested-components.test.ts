import { describe, expect, it, vi } from 'vitest'
import { Component, provideZonelessChangeDetection, type Type } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { renderApplication } from '@angular/platform-server'
import { parseMarkdown, type MarkdownDocument as MarkdownDocumentType } from 'comark'
import { MarkdownDocument } from '../src/components/markdown-document.component.ts'

/** Badge — applied via decorator factory so Vitest/oxc need not enable experimentalDecorators. */
class Badge {
  name = 'badge'
}
Component({
  selector: 'app-badge',
  standalone: true,
  template: `<span class="badge">{{ name }}</span>`,
  inputs: ['name'],
})(Badge)

/** Broken — throws during construction to exercise render error handling. */
class Broken {
  constructor() {
    throw new Error('constructor failed')
  }
}
Component({
  selector: 'app-broken',
  standalone: true,
  template: `<span>broken</span>`,
})(Broken)

async function renderMarkdown(
  markdown: string,
  components: Record<string, Type<unknown>> = { badge: Badge as Type<unknown> }
): Promise<string> {
  const document = await parseMarkdown(markdown)

  class App {
    document: MarkdownDocumentType = document
    components = components
  }
  Component({
    selector: 'app-root',
    standalone: true,
    imports: [MarkdownDocument],
    template: `
      <comark-markdown-document
        [value]="document"
        [components]="components"
      />
    `,
  })(App)

  return renderApplication(
    (context) =>
      bootstrapApplication(
        App,
        {
          providers: [provideZonelessChangeDetection()],
        },
        context
      ),
    {
      document: '<!DOCTYPE html><html><head></head><body><app-root></app-root></body></html>',
    }
  )
}

describe('nested components', () => {
  it('renders the document directly into the host, with no wrapper or comment markers', async () => {
    const html = await renderMarkdown('# Hello **World**\n\nA paragraph.')

    expect(html).toContain('comark-markdown-document')
    expect(html).toContain('comark-content')
    expect(html).toContain('display: block')
    // The host renders the markdown itself — no wrapper element, no block anchor.
    expect(html).not.toContain('<comark-markdown-node')
    expect((html.match(/<!--/g) || []).length).toBe(0)
    expect(html).toContain('<h1')
    expect(html).toContain('<p')
  })

  it('renders a nested custom component directly without a wrapper', async () => {
    const html = await renderMarkdown('::badge\nshown\n::', { badge: Badge as Type<unknown> })

    expect(html).toContain('<app-badge')
    expect(html).not.toContain('<comark-markdown-node')
    expect((html.match(/<!--/g) || []).length).toBe(0)
  })

  it('logs a failed custom component and continues with later siblings', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const html = await renderMarkdown('::broken\ngone\n::\n\nstill rendered', {
      broken: Broken as Type<unknown>,
    })

    expect(consoleError).toHaveBeenCalledWith('Failed to render custom component "broken"', expect.any(Error))

    expect(html).not.toContain('gone')
    expect(html).toContain('still rendered')

    consoleError.mockRestore()
  })

  it('renders Badge component name for inline :badge', async () => {
    const html = await renderMarkdown('Hello :badge')

    expect(html).toContain('class="badge"')
    expect(html).toContain('>badge</span>')
    expect(html).not.toContain('<comark-markdown-node')
    expect((html.match(/<!--/g) || []).length).toBe(0)
  })
  it('renders Badge component name for inline :badge with custom name', async () => {
    const html = await renderMarkdown('Hello :badge{name="Ahad"}')

    expect(html).toContain('class="badge"')
    expect(html).toContain('>Ahad</span>')
  })
})
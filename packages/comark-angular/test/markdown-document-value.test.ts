import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Component } from '@angular/core'
import { parseMarkdown } from 'comark'
import { isMarkdownDocument } from 'comark/utils'
import type { MarkdownDocument } from 'comark'
import { Markdown } from '../src/components/markdown.component.ts'
import { ComponentFixture, TestBed } from '@angular/core/testing'

let counterInstances = 0

class Counter {
  readonly n = ++counterInstances
}
Component({
  selector: 'app-counter',
  standalone: true,
  template: `<span>counter</span>`,
})(Counter)

describe('Markdown value as MarkdownDocument', () => {
  let component: Markdown
  let fixture: ComponentFixture<Markdown>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Markdown],
    }).compileComponents()

    fixture = TestBed.createComponent(Markdown)
    component = fixture.componentInstance
    await fixture.whenStable()
  })

  it('assigns a pre-parsed document without calling parse', async () => {
    const document = await parseMarkdown('# Hello **World**')

    fixture.componentRef.setInput('value', document)
    fixture.detectChanges()
    await fixture.whenStable()

    expect(isMarkdownDocument(component.value())).toBe(true)
    expect(component.document).toBe(document)
    expect(component.document!.nodes[0]?.[0]).toBe('h1')
  })

  it('still parses markdown strings', async () => {
    fixture.componentRef.setInput('value', 'Hello **world**')
    fixture.detectChanges()

    await vi.waitFor(() => {
      expect(component.document).not.toBeNull()
    })

    expect(component.document!.nodes[0]?.[0]).toBe('p')
  })

  it('accepts an empty document', async () => {
    const empty: MarkdownDocument = { nodes: [], frontmatter: {}, meta: {} }
    fixture.componentRef.setInput('value', empty)
    fixture.detectChanges()
    await fixture.whenStable()

    expect(component.document).toBe(empty)
    expect(component.document!.nodes).toEqual([])
  })

  it('renders a flat DOM with the content class on its own host', async () => {
    fixture.componentRef.setInput('value', '# Hello **World**\n\nA paragraph.')
    fixture.detectChanges()

    await vi.waitFor(() => {
      expect(component.document).not.toBeNull()
    })
    fixture.detectChanges()
    await fixture.whenStable()

    const host = fixture.nativeElement as HTMLElement
    expect(host.classList.contains('comark-content')).toBe(true)
    expect(getComputedStyle(host).display).toBe('block')
    expect(host.querySelector('comark-markdown-document')).toBeNull()
    // The markdown lives in the host itself — no renderer wrapper element at all.
    expect(host.querySelector('comark-markdown-node')).toBeNull()
    expect(Array.from(host.children).map((child) => child.tagName)).toEqual(['H1', 'P'])
  })

  it('leaves no comment or wrapper markers inside the host', async () => {
    fixture.componentRef.setInput('value', '# Hello\n\nA paragraph.')
    fixture.detectChanges()

    await vi.waitFor(() => {
      expect(component.document).not.toBeNull()
    })
    fixture.detectChanges()
    await fixture.whenStable()

    const host = fixture.nativeElement as HTMLElement

    const markers: string[] = []
    const collect = (el: Element): void => {
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.COMMENT_NODE) {
          markers.push(`comment(${child.nodeValue})`)
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = (child as Element).tagName.toLowerCase()
          if (tag === 'comark-markdown-node' || tag === 'comark-markdown-document') {
            markers.push(`element(${tag})`)
          }
          collect(child as Element)
        }
      }
    }
    collect(host)

    expect(markers).toEqual([])
  })

  it('re-renders the DOM when the parsed document changes', async () => {
    fixture.componentRef.setInput('value', 'First')
    fixture.detectChanges()
    await vi.waitFor(() => {
      expect(component.document).not.toBeNull()
    })
    fixture.detectChanges()
    await fixture.whenStable()

    const host = fixture.nativeElement as HTMLElement
    expect(host.textContent).toContain('First')

    fixture.componentRef.setInput('value', 'Second')
    fixture.detectChanges()
    await vi.waitFor(() => {
      expect(JSON.stringify(component.document?.nodes)).toContain('Second')
    })
    fixture.detectChanges()
    await fixture.whenStable()

    expect(host.textContent).toContain('Second')
    expect(host.textContent).not.toContain('First')
  })

  it('does not recreate dynamic components across change detection cycles', async () => {
    counterInstances = 0
    fixture.componentRef.setInput('value', 'Hello :counter')
    fixture.componentRef.setInput('components', { counter: Counter })
    fixture.detectChanges()

    await vi.waitFor(() => {
      expect(component.document).not.toBeNull()
    })
    fixture.detectChanges()
    await fixture.whenStable()

    const host = fixture.nativeElement as HTMLElement
    const first = host.querySelector('app-counter')
    expect(first).not.toBeNull()

    // Changing an unrelated input re-checks this OnPush view, re-evaluating the
    // `[nodes]`/`[renderData]` bindings. They must keep a stable reference or
    // the child would tear down and rebuild every dynamic component.
    for (let i = 0; i < 3; i++) {
      fixture.componentRef.setInput('documentKey', `k${i}`)
      fixture.detectChanges()
    }

    expect(host.querySelectorAll('app-counter').length).toBe(1)
    expect(host.querySelector('app-counter')).toBe(first)
    expect(counterInstances).toBe(1)
  })
})

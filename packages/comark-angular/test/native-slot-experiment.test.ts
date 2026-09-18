/**
 * EXPERIMENT — is `<slot name="…">` + `ViewEncapsulation.ShadowDom` a viable slot
 * contract for `@comark/angular`?
 *
 * `<slot>` is NOT Angular API: Angular's projector is `<ng-content>`, compiled into
 * `ngContentSelectors` and consumed by `projectNodes()`. A `<slot>` element only
 * does anything when the component uses `ViewEncapsulation.ShadowDom`, where the
 * template lives in a real shadow root and the BROWSER performs the slotting:
 * the host's light-DOM children are assigned to matching `<slot>` elements by
 * their `slot` attribute.
 *
 * Conclusion (measured below, not assumed): the documented `<ng-content select>`
 * contract is the one that works with Comark's dynamic rendering. A `<slot>`
 * template is out of reach for the current engine because `createComponent`'s
 * `projectableNodes` are consumed ONLY by `ng-content` anchors — see
 * `projectNodes()` in `@angular/core`'s `_debug_node-chunk.mjs`:
 *
 *     for (let i = 0; i < ngContentSelectors.length; i++) { … }
 *
 * A `<slot>`-only template reports `ngContentSelectors === []`, so the loop never
 * runs and every node handed to `createComponent` is discarded. Native slotting
 * only engages for light-DOM children of the host, which the engine never creates
 * for this case.
 *
 * These tests pin the measured behaviour. Tests requiring real native slot
 * assignment are skipped where the environment cannot provide it (jsdom), so the
 * default `pnpm test` run stays green while `--browsers=chromium` exercises them
 * for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApplicationRef,
  Component,
  EnvironmentInjector,
  ViewEncapsulation,
  createComponent,
  reflectComponentType,
  type Type,
} from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { bootstrapApplication } from '@angular/platform-browser'
import { renderApplication } from '@angular/platform-server'
import { parseMarkdown, type MarkdownDocument as MarkdownDocumentType } from 'comark'
import { Markdown } from '../src/components/markdown.component.ts'
import { MarkdownDocument } from '../src/components/markdown-document.component.ts'

/** ShadowDom + native `<slot>` elements, mirroring the example's FeatureCard. */
class ShadowCard {}
Component({
  selector: 'app-shadow-card',
  standalone: true,
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <section class="card">
      <header class="card-header"><slot name="header"></slot></header>
      <article class="card-body"><slot></slot></article>
      <footer class="card-footer"><slot name="footer"></slot></footer>
    </section>
  `,
})(ShadowCard)

/** Emulated (default) encapsulation + `<ng-content select>` — the documented contract. */
class NgContentCard {}
Component({
  selector: 'app-ngcontent-card',
  standalone: true,
  template: `
    <section class="card">
      <header class="card-header"><ng-content select="[slot=header]" /></header>
      <article class="card-body"><ng-content /></article>
      <footer class="card-footer"><ng-content select="[slot=footer]" /></footer>
    </section>
  `,
})(NgContentCard)

/**
 * ShadowDom + Angular's own `<ng-content select>` — isolates whether ShadowDom is
 * the problem or only the `<slot>` element is.
 */
class ShadowNgContentCard {}
Component({
  selector: 'app-shadow-ngcontent-card',
  standalone: true,
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <section class="card">
      <header class="card-header"><ng-content select="[slot=header]" /></header>
      <article class="card-body"><ng-content /></article>
      <footer class="card-footer"><ng-content select="[slot=footer]" /></footer>
    </section>
  `,
})(ShadowNgContentCard)

/** True when the environment really performs native slot assignment (not jsdom). */
function supportsNativeSlotting(): boolean {
  try {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<slot name="probe"></slot>'
    const child = document.createElement('span')
    child.setAttribute('slot', 'probe')
    host.appendChild(child)
    const slot = shadow.querySelector('slot') as HTMLSlotElement
    return typeof slot.assignedNodes === 'function' && slot.assignedNodes().length === 1
  } catch {
    return false
  }
}

const NATIVE_SLOTTING = supportsNativeSlotting()

/** Structured view of where content actually ended up for a host element. */
function inspect(host: Element | null) {
  const empty = {
    error: 'host not found' as string | null,
    tag: '',
    outerHTML: '',
    childNodeCount: 0,
    hasShadowRoot: false,
    lightChildren: [] as { tag: string; slotAttr: string | null; text: string }[],
    slots: [] as {
      name: string | null
      parent: string | null
      assigned: { tag: string; slotAttr: string | null; text: string }[]
    }[],
    unassignedLightChildren: [] as string[],
    shadowHTML: null as string | null,
  }
  if (!host) return empty

  const shadow = (host as HTMLElement).shadowRoot
  const lightChildren = Array.from(host.children)
  const assignedAnywhere = new Set<Element>()

  const slots = shadow
    ? Array.from(shadow.querySelectorAll('slot')).map((slot) => {
        const assigned =
          typeof (slot as HTMLSlotElement).assignedElements === 'function'
            ? (slot as HTMLSlotElement).assignedElements()
            : []
        for (const el of assigned) assignedAnywhere.add(el)
        return {
          name: slot.getAttribute('name'),
          parent: slot.parentElement
            ? `${slot.parentElement.tagName.toLowerCase()}.${slot.parentElement.className.trim()}`
            : null,
          assigned: assigned.map((el) => ({
            tag: el.tagName.toLowerCase(),
            slotAttr: el.getAttribute('slot'),
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
          })),
        }
      })
    : []

  return {
    error: null,
    tag: host.tagName.toLowerCase(),
    outerHTML: host.outerHTML.replace(/\s+/g, ' ').slice(0, 400),
    childNodeCount: host.childNodes.length,
    hasShadowRoot: !!shadow,
    lightChildren: lightChildren.map((el) => ({
      tag: el.tagName.toLowerCase(),
      slotAttr: el.getAttribute('slot'),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    })),
    slots,
    unassignedLightChildren: NATIVE_SLOTTING
      ? lightChildren
          .filter((el) => !assignedAnywhere.has(el))
          .map((el) => `${el.tagName.toLowerCase()}[slot=${el.getAttribute('slot')}]`)
      : [],
    shadowHTML: shadow ? shadow.innerHTML.replace(/\s+/g, ' ').slice(0, 260) : null,
  }
}

const SHADOW_MARKDOWN = `::shadow-card
#header
HEADER content

#default
DEFAULT content

#footer
FOOTER content
::`

const NGCONTENT_MARKDOWN = SHADOW_MARKDOWN.replace('shadow-card', 'ngcontent-card')

describe('native <slot> + ShadowDom is not a viable slot contract', () => {
  describe('projection metadata', () => {
    it('a <slot> template declares no ng-content selectors', () => {
      // Angular does not treat `<slot>` as projection, so the positional
      // `projectableNodes` mapping has nothing to match against.
      expect(reflectComponentType(ShadowCard as Type<unknown>)?.ngContentSelectors).toEqual([])
    })

    it('an <ng-content select> template declares them in template order', () => {
      expect(reflectComponentType(NgContentCard as Type<unknown>)?.ngContentSelectors).toEqual([
        '[slot=header]',
        '*',
        '[slot=footer]',
      ])
    })

    it('a ShadowDom template with <ng-content select> also declares them', () => {
      expect(reflectComponentType(ShadowNgContentCard as Type<unknown>)?.ngContentSelectors).toEqual([
        '[slot=header]',
        '*',
        '[slot=footer]',
      ])
    })
  })

  describe('A — the current engine against a ShadowDom component', () => {
    let fixture: ComponentFixture<Markdown>

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [Markdown] }).compileComponents()
      fixture = TestBed.createComponent(Markdown)
      await fixture.whenStable()
    })

    async function render(value: string, components: Record<string, unknown>): Promise<HTMLElement> {
      fixture.componentRef.setInput('value', value)
      fixture.componentRef.setInput('components', components)
      fixture.detectChanges()
      await vi.waitFor(() => {
        expect(fixture.componentInstance.document).not.toBeNull()
      })
      fixture.detectChanges()
      await fixture.whenStable()
      return fixture.nativeElement as HTMLElement
    }

    it('renders the ShadowDom host completely empty, losing every slot', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const host = await render(SHADOW_MARKDOWN, { 'shadow-card': ShadowCard })
      const report = inspect(host.querySelector('app-shadow-card'))

      // The shadow root exists with its three slots…
      expect(report.hasShadowRoot).toBe(true)
      expect(report.shadowHTML).toContain('<slot name="header">')
      expect(report.shadowHTML).toContain('<slot name="footer">')

      // …but NOTHING reaches it: no light DOM, nothing assigned to any slot.
      expect(report.outerHTML).toBe('<app-shadow-card></app-shadow-card>')
      expect(report.childNodeCount).toBe(0)
      expect(report.lightChildren).toEqual([])
      expect(report.slots.map((s) => s.assigned)).toEqual([[], [], []])
      expect(report.shadowHTML).not.toContain('HEADER content')
      expect(report.shadowHTML).not.toContain('DEFAULT content')

      // The loss is silent: the engine's error path is never triggered.
      expect(consoleError).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('ShadowDom with <ng-content select> still projects correctly', async () => {
      const host = await render(SHADOW_MARKDOWN.replace('shadow-card', 'shadow-ngcontent-card'), {
        'shadow-ngcontent-card': ShadowNgContentCard,
      })
      const card = host.querySelector('app-shadow-ngcontent-card') as HTMLElement
      const shadow = card.shadowRoot!

      // The template lives in the shadow root, and Angular's projection anchors
      // there receive the content — ShadowDom itself is not the blocker.
      expect(shadow).toBeTruthy()
      expect(shadow.querySelector('.card-header')!.textContent).toContain('HEADER content')
      expect(shadow.querySelector('.card-body')!.textContent).toContain('DEFAULT content')
      expect(shadow.querySelector('.card-footer')!.textContent).toContain('FOOTER content')
      // Nothing dangles in the light DOM.
      expect(card.children.length).toBe(0)
    })

    it('control: the documented ng-content contract routes every slot correctly', async () => {
      const host = await render(NGCONTENT_MARKDOWN, { 'ngcontent-card': NgContentCard })
      const card = host.querySelector('app-ngcontent-card') as HTMLElement

      expect(card.querySelector('.card-header')!.textContent).toContain('HEADER content')
      expect(card.querySelector('.card-body')!.textContent).toContain('DEFAULT content')
      expect(card.querySelector('.card-footer')!.textContent).toContain('FOOTER content')
      expect(card.children.length).toBe(1)
    })
  })

  describe('B — the light-DOM route native slotting needs', () => {
    it.skipIf(!NATIVE_SLOTTING)('assigns light-DOM children to the matching native slots', () => {
      const ref = createComponent(ShadowCard as Type<unknown>, {
        environmentInjector: TestBed.inject(EnvironmentInjector),
      })
      TestBed.inject(ApplicationRef).attachView(ref.hostView)
      const host = ref.location.nativeElement as HTMLElement
      ref.changeDetectorRef.detectChanges()

      // The same shapes the engine builds for ng-content, but appended as DIRECT
      // light-DOM children of the host instead of passed as `projectableNodes`.
      const header = document.createElement('div')
      header.setAttribute('slot', 'header')
      header.style.display = 'contents'
      header.appendChild(document.createElement('p')).textContent = 'HEADER content'

      const body = document.createElement('p')
      body.textContent = 'DEFAULT content'

      const footer = document.createElement('div')
      footer.setAttribute('slot', 'footer')
      footer.style.display = 'contents'
      footer.appendChild(document.createElement('p')).textContent = 'FOOTER content'

      host.append(header, body, footer)

      const report = inspect(host)
      const bySlot = new Map(report.slots.map((s) => [s.name, s.assigned.map((a) => a.text).join(' ')]))
      expect(bySlot.get('header')).toContain('HEADER content')
      expect(bySlot.get(null)).toContain('DEFAULT content')
      expect(bySlot.get('footer')).toContain('FOOTER content')
      expect(report.unassignedLightChildren).toEqual([])

      ref.destroy()
    })

    it.skipIf(!NATIVE_SLOTTING)('leaves a named child with no matching slot unassigned and invisible', () => {
      const ref = createComponent(ShadowCard as Type<unknown>, {
        environmentInjector: TestBed.inject(EnvironmentInjector),
      })
      TestBed.inject(ApplicationRef).attachView(ref.hostView)
      const host = ref.location.nativeElement as HTMLElement
      ref.changeDetectorRef.detectChanges()

      const orphan = document.createElement('div')
      orphan.setAttribute('slot', 'nope')
      orphan.textContent = 'ORPHAN content'
      host.appendChild(orphan)

      const report = inspect(host)
      // Native slotting never falls back to the default <slot> for a named child.
      expect(report.unassignedLightChildren).toEqual(['div[slot=nope]'])
      expect(report.slots.flatMap((s) => s.assigned)).toEqual([])
      expect(report.shadowHTML).not.toContain('ORPHAN content')

      ref.destroy()
    })
  })

  describe('C — SSR serialization', () => {
    async function renderSsr(markdown: string, components: Record<string, Type<unknown>>): Promise<string> {
      const document = await parseMarkdown(markdown)

      class App {
        document: MarkdownDocumentType = document
        components = components
      }
      Component({
        selector: 'app-root',
        standalone: true,
        imports: [MarkdownDocument],
        template: `<comark-markdown-document [value]="document" [components]="components" />`,
      })(App)

      return renderApplication((context) => bootstrapApplication(App, { providers: [] }, context), {
        document: '<!DOCTYPE html><html><head></head><body><app-root></app-root></body></html>',
      })
    }

    it('flattens the shadow template into the host, with no shadow root and no content', async () => {
      const html = await renderSsr(SHADOW_MARKDOWN, { 'shadow-card': ShadowCard as Type<unknown> })
      const body = html.slice(html.indexOf('<app-root'))

      // No shadow root is declared on the server…
      expect(body).not.toContain('shadowroot')
      // …the template is emitted as plain children of the host instead, wearing
      // emulated-encapsulation attributes the client will never produce…
      expect(body).toContain('_nghost-')
      expect(body).toContain('_ngcontent-')
      expect(body).toContain('<slot')
      // …and no slot content survives.
      expect(body).not.toContain('HEADER content')
      expect(body).not.toContain('DEFAULT content')
      expect(body).not.toContain('FOOTER content')
    })

    it('flattens a ShadowDom template even when <ng-content> projection works', async () => {
      const html = await renderSsr(SHADOW_MARKDOWN.replace('shadow-card', 'shadow-ngcontent-card'), {
        'shadow-ngcontent-card': ShadowNgContentCard as Type<unknown>,
      })
      const body = html.slice(html.indexOf('<app-root'))

      // Content survives because projection goes through <ng-content>…
      expect(body).toContain('HEADER content')
      expect(body).toContain('DEFAULT content')
      expect(body).toContain('FOOTER content')
      // …but the server still emits a flattened host with emulated-encapsulation
      // attributes instead of declaring a shadow root, so the DOM shape the client
      // builds from this HTML differs from the client-rendered shape.
      expect(body).not.toContain('shadowroot')
      expect(body).toContain('_nghost-')
      expect(body).toContain('_ngcontent-')
    })

    it('control: serializes the ng-content contract with every slot filled', async () => {
      const html = await renderSsr(NGCONTENT_MARKDOWN, { 'ngcontent-card': NgContentCard as Type<unknown> })
      const body = html.slice(html.indexOf('<app-root'))

      expect(body).toContain('<app-ngcontent-card>')
      expect(body).toContain('<div slot="header" style="display: contents;">HEADER content</div>')
      expect(body).toContain('DEFAULT content')
      expect(body).toContain('<div slot="footer" style="display: contents;">FOOTER content</div>')
      // No encapsulation attributes leak into the imperative renderer's DOM.
      expect(body).not.toContain('_nghost-')
      expect(body).not.toContain('_ngcontent-')
    })
  })
})

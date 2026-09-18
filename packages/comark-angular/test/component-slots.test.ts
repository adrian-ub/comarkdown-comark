import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Component } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { parseMarkdown } from 'comark'
import { Markdown } from '../src/components/markdown.component.ts'
import { MarkdownDocument } from '../src/components/markdown-document.component.ts'

/**
 * Mimics the example's FeatureCardComponent: the catch-all `<ng-content />` sits
 * between two named slots.
 */
class FeatureCard {}
Component({
  selector: 'app-feature-card',
  standalone: true,
  template: `
    <section>
      <header class="card-header"><ng-content select="[slot=header]" /></header>
      <article class="card-body"><ng-content /></article>
      <footer class="card-footer"><ng-content select="[slot=footer]" /></footer>
    </section>
  `,
})(FeatureCard)

/**
 * The catch-all is declared FIRST — proves the slot mapping follows the
 * template declaration order instead of assuming a fixed layout.
 */
class SidebarPanel {}
Component({
  selector: 'app-sidebar-panel',
  standalone: true,
  template: `
    <div class="panel-body"><ng-content /></div>
    <aside class="panel-side"><ng-content select="[slot=side]" /></aside>
  `,
})(SidebarPanel)

/** The most common shape: a single catch-all. */
class SimpleBox {}
Component({
  selector: 'app-simple-box',
  standalone: true,
  template: `<div class="box"><ng-content /></div>`,
})(SimpleBox)

/** Custom component used inside a named slot, to check nested projection. */
class Chip {}
Component({
  selector: 'app-chip',
  standalone: true,
  template: `<span class="chip"><ng-content /></span>`,
})(Chip)

/** Two named slots and no catch-all. */
class NamedOnly {}
Component({
  selector: 'app-named-only',
  standalone: true,
  template: `
    <div class="only-a"><ng-content select="[slot=a]" /></div>
    <div class="only-b"><ng-content select="[slot=b]" /></div>
  `,
})(NamedOnly)

const SLOT_MARKDOWN = `::feature-card
#header
Slot-aware Angular component

#default
This body is the default slot.

#footer
Rendered through the footer slot.
::`

describe('component slots', () => {
  describe('through <comark-markdown>', () => {
    let fixture: ComponentFixture<Markdown>
    let component: Markdown

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [Markdown] }).compileComponents()
      fixture = TestBed.createComponent(Markdown)
      component = fixture.componentInstance
      await fixture.whenStable()
    })

    /** Render markdown and wait until the parsed document has reached the DOM. */
    async function render(value: string, components: Record<string, unknown>): Promise<HTMLElement> {
      fixture.componentRef.setInput('value', value)
      fixture.componentRef.setInput('components', components)
      fixture.detectChanges()

      await vi.waitFor(() => {
        expect(component.document).not.toBeNull()
      })
      fixture.detectChanges()
      await fixture.whenStable()

      return fixture.nativeElement as HTMLElement
    }

    it('routes default content to the catch-all and #name content to its [slot=name] ng-content', async () => {
      const host = await render(SLOT_MARKDOWN, { 'feature-card': FeatureCard })
      const card = host.querySelector('app-feature-card') as HTMLElement
      expect(card).not.toBeNull()

      // #header → <ng-content select="[slot=header]" />
      expect(card.querySelector('.card-header')!.textContent).toContain('Slot-aware Angular component')
      // default → <ng-content />
      expect(card.querySelector('.card-body')!.textContent).toContain('This body is the default slot')
      // #footer → <ng-content select="[slot=footer]" />
      expect(card.querySelector('.card-footer')!.textContent).toContain('Rendered through the footer slot')

      // The default content must NOT fall into the first named slot.
      expect(card.querySelector('.card-header')!.textContent).not.toContain('This body is the default slot')
      // ...and every slot must be filled, not left empty by an off-by-one.
      expect(card.querySelector('.card-body')!.textContent).not.toBe('')
      expect(card.querySelector('.card-footer')!.textContent).not.toBe('')
    })

    it('keeps each slot wrapper inside the ng-content it was matched to', async () => {
      const host = await render(SLOT_MARKDOWN, { 'feature-card': FeatureCard })
      const card = host.querySelector('app-feature-card') as HTMLElement

      expect(card.querySelector('.card-header > [slot=header]')).not.toBeNull()
      expect(card.querySelector('.card-footer > [slot=footer]')).not.toBeNull()
    })

    it('leaves no orphaned slot wrappers on the component host', async () => {
      const host = await render(SLOT_MARKDOWN, { 'feature-card': FeatureCard })
      const card = host.querySelector('app-feature-card') as HTMLElement

      // Everything the component received is projected inside <section>; nothing
      // may dangle as a host child outside the template.
      expect(card.children.length).toBe(1)
      expect(card.firstElementChild!.tagName).toBe('SECTION')
      expect(Array.from(card.children).filter((child) => child.hasAttribute('slot'))).toEqual([])
    })

    it('follows template declaration order, not the selector text', async () => {
      // Catch-all declared first, named slot second. Content before the first
      // `#name` marker is the component's default content.
      const host = await render(
        `::sidebar-panel
Body content

#side
Side content
::`,
        { 'sidebar-panel': SidebarPanel }
      )
      const panel = host.querySelector('app-sidebar-panel') as HTMLElement

      expect(panel.querySelector('.panel-body')!.textContent).toContain('Body content')
      expect(panel.querySelector('.panel-side')!.textContent).toContain('Side content')
      expect(panel.querySelector('.panel-body')!.textContent).not.toContain('Side content')
    })

    it('projects plain content into a single catch-all component', async () => {
      const host = await render('::simple-box\nJust content\n::', { 'simple-box': SimpleBox })
      const box = host.querySelector('app-simple-box') as HTMLElement

      expect(box.querySelector('.box')!.textContent).toContain('Just content')
    })

    it('projects an explicit #default slot into the catch-all', async () => {
      const host = await render(
        `::feature-card
#header
H

#default
D

#footer
F
::`,
        { 'feature-card': FeatureCard }
      )
      const card = host.querySelector('app-feature-card') as HTMLElement

      expect(card.querySelector('.card-header')!.textContent).toContain('H')
      expect(card.querySelector('.card-body')!.textContent).toContain('D')
      expect(card.querySelector('.card-footer')!.textContent).toContain('F')
    })

    it('projects into two named slots when there is no catch-all', async () => {
      const host = await render(
        `::named-only
#a
Alpha

#b
Beta
::`,
        { 'named-only': NamedOnly }
      )
      const only = host.querySelector('app-named-only') as HTMLElement

      expect(only.querySelector('.only-a')!.textContent).toContain('Alpha')
      expect(only.querySelector('.only-b')!.textContent).toContain('Beta')
    })

    it('renders nested custom components inside a named slot', async () => {
      const host = await render(
        `::feature-card
#header
:chip[Inline chip]

#default
Body
::`,
        { 'feature-card': FeatureCard, chip: Chip }
      )
      const card = host.querySelector('app-feature-card') as HTMLElement

      expect(card.querySelector('.card-header app-chip .chip')!.textContent).toContain('Inline chip')
      expect(card.querySelector('.card-body')!.textContent).toContain('Body')
    })

    it('renders markdown formatting inside a named slot', async () => {
      const host = await render(
        `::feature-card
#footer
Bold **footer** text
::`,
        { 'feature-card': FeatureCard }
      )
      const card = host.querySelector('app-feature-card') as HTMLElement

      expect(card.querySelector('.card-footer strong')!.textContent).toBe('footer')
      expect(card.querySelector('.card-body')!.textContent).toBe('')
    })
  })

  describe('through <comark-markdown-document>', () => {
    let fixture: ComponentFixture<MarkdownDocument>

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [MarkdownDocument] }).compileComponents()
      fixture = TestBed.createComponent(MarkdownDocument)
      await fixture.whenStable()
    })

    it('routes slots through the shared engine for a pre-parsed document', async () => {
      const document = await parseMarkdown(SLOT_MARKDOWN)

      fixture.componentRef.setInput('value', document)
      fixture.componentRef.setInput('components', { 'feature-card': FeatureCard })
      fixture.detectChanges()
      await fixture.whenStable()

      const host = fixture.nativeElement as HTMLElement
      const card = host.querySelector('app-feature-card') as HTMLElement

      expect(card).not.toBeNull()
      expect(card.querySelector('.card-header')!.textContent).toContain('Slot-aware Angular component')
      expect(card.querySelector('.card-body')!.textContent).toContain('This body is the default slot')
      expect(card.querySelector('.card-footer')!.textContent).toContain('Rendered through the footer slot')
      // No slots dangling as host children outside the template.
      expect(card.children.length).toBe(1)
      expect(Array.from(card.children).filter((child) => child.hasAttribute('slot'))).toEqual([])
    })
  })
})

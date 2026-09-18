import { Component, ChangeDetectionStrategy, computed, inject, input, type Type } from '@angular/core'
import type { MarkdownDocument as MarkdownDocumentType } from 'comark'
import { MARKDOWN_DOCUMENT_CONFIG } from '../config'
import type { MarkdownDocumentConfig } from '../config'
import { MarkdownRenderBase } from './markdown-render-base'

/**
 * MarkdownDocument component
 *
 * Renders an already-parsed Markdown document to Angular components/HTML — no
 * parser in the client bundle. Supports custom component mapping for
 * element tags.
 *
 * The component has no template: the document is rendered directly into its own
 * host element (which carries `.comark-content`), so there is no wrapper element
 * between `<comark-markdown-document>` and the markdown it produces.
 *
 * @example
 * ```html
 * <comark-markdown-document [value]="document" [components]="customComponents" />
 * ```
 */
@Component({
  selector: 'comark-markdown-document',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: {
    '[class]': 'contentClass',
    style: 'display: block',
  },
})
export class MarkdownDocument extends MarkdownRenderBase {
  /** The parsed Markdown document to render */
  readonly value = input<MarkdownDocumentType>()

  private readonly config: MarkdownDocumentConfig | null = inject(MARKDOWN_DOCUMENT_CONFIG, { optional: true })

  protected override get renderDocument(): MarkdownDocumentType | null {
    return this.value() ?? null
  }

  /** Config-level and instance-level components merged, instance wins. */
  private readonly mergedComponents = computed(() => ({ ...(this.config?.components ?? {}), ...this.components() }))

  protected override get componentsMap(): Record<string, Type<any>> {
    return this.mergedComponents()
  }

  get contentClass(): string {
    return ['comark-content', this.config?.class].filter(Boolean).join(' ')
  }
}

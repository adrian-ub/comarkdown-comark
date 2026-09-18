import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Type,
  computed,
  inject,
  input,
  effect,
  model,
} from '@angular/core'
import { createSerializedMarkdownParser } from 'comark'
import type { ParserOptions, MarkdownDocument as MarkdownDocumentType } from 'comark'
import { isMarkdownDocument } from 'comark/utils'
import { MARKDOWN_CONFIG } from '../config'
import type { MarkdownConfig } from '../config'
import { MarkdownDocument } from './markdown-document.component'

/**
 * High-level Markdown component that accepts raw markdown, parses it,
 * and renders the resulting document.
 *
 * @example
 * ```html
 * <comark-markdown [value]="content" [components]="customComponents" />
 * ```
 */
@Component({
  selector: 'comark-markdown',
  standalone: true,
  imports: [MarkdownDocument],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass',
  },
  template: `
    @if (document) {
      <comark-markdown-document
        [value]="document"
        [components]="mergedComponents()"
        [streaming]="streaming()"
        [caret]="caret()"
        [data]="data()"
      />
    }
  `,
})
export class Markdown {
  private readonly config: MarkdownConfig | null = inject(MARKDOWN_CONFIG, { optional: true })

  /** The markdown content to parse and render, or a pre-parsed MarkdownDocument */
  readonly value = input<string | MarkdownDocumentType>()

  /** Parser options (excluding plugins) */
  readonly options = model<Omit<ParserOptions, 'plugins'>>({})

  /** Additional plugins to use */
  readonly plugins = model<ParserOptions['plugins']>([])

  /**
   * Strip wrapper tags from the top level of the document — shorthand for
   * `options.unwrap`. `true` unwraps `<p>`; a space-separated string or array
   * unwraps the listed tags.
   */
  readonly unwrap = input<boolean | string | string[]>(false)

  /** Custom component mappings for element tags */
  readonly components = input<Record<string, Type<any>>>({})

  /** Enable streaming mode */
  readonly streaming = input<boolean>(false)

  /** If document has a <!-- more --> comment, only render content before it */
  readonly summary = input<boolean>(false)

  /** Append a caret to the last text node (for streaming UIs) */
  readonly caret = input<boolean | { class: string }>(false)

  /** Additional data to pass to the renderer for :binding resolution */
  readonly data = input<Record<string, unknown>>({})

  /** Config-level and instance-level components merged, instance wins. */
  protected readonly mergedComponents = computed(() => ({ ...(this.config?.components ?? {}), ...this.components() }))

  get hostClass(): string {
    return this.config?.class ?? ''
  }

  document: MarkdownDocumentType | null = null

  private serializedParse = createSerializedMarkdownParser({})

  private cdr = inject(ChangeDetectorRef)

  /**
   * Effective plugins: config-level plugins first, then instance plugins,
   * deduplicated by plugin name so a plugin supplied by both runs once.
   */
  private readonly effectivePlugins = computed<ParserOptions['plugins']>(() => {
    const names = new Set<string>()
    return [...(this.config?.plugins ?? []), ...(this.plugins() ?? [])].filter((plugin) => {
      if (names.has(plugin.name)) return false
      names.add(plugin.name)
      return true
    })
  })

  /**
   * Compose the parse options consumed by the serialized parser.
   *
   * Config-level defaults are merged under the `options`/`plugins` inputs so
   * instance values override config defaults, without writing back to the
   * input signals (the parser consumes the derived value instead).
   */
  protected getParserOptions(): ParserOptions {
    return {
      ...(this.config?.options ?? {}),
      ...this.options(),
      ...(this.unwrap() ? { unwrap: this.unwrap() } : {}),
      plugins: this.effectivePlugins(),
    }
  }

  private readonly serializedParseEffect = effect(() => {
    this.serializedParse = createSerializedMarkdownParser(this.getParserOptions())
  })

  private readonly parseMarkdownEffect = effect(() => {
    const value = this.value()
    if (value === undefined || value === null) {
      this.document = null
      return
    }

    this.parseMarkdown()
  })

  private parseMarkdown(): void {
    // Pre-parsed document — skip parsing and render directly
    if (isMarkdownDocument(this.value())) {
      this.document = this.value() as MarkdownDocumentType
      this.cdr.markForCheck()
      return
    }

    let source = (this.value() as string | undefined) ?? ''
    if (this.summary()) {
      source = source.split('<!-- more -->')[0] || ''
    }
    source = source.trim()

    this.serializedParse(source, { streaming: this.streaming() }).then((result) => {
      this.document = result
      this.cdr.markForCheck()
    })
  }
}

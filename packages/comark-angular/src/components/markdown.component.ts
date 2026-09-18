import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
  effect,
  model,
  signal,
  type Type,
} from '@angular/core'
import { createSerializedMarkdownParser } from 'comark'
import type { ParserOptions, MarkdownDocument as MarkdownDocumentType } from 'comark'
import { isMarkdownDocument } from 'comark/utils'
import { MARKDOWN_CONFIG } from '../config'
import type { MarkdownConfig } from '../config'
import { MarkdownRenderBase } from './markdown-render-base'

/**
 * High-level Markdown component that accepts raw markdown, parses it,
 * and renders the resulting document.
 *
 * The component has no template: the markdown is rendered directly into its own
 * host element (which carries `.comark-content`), so there is no wrapper element
 * between `<comark-markdown>` and the markdown it produces.
 *
 * @example
 * ```html
 * <comark-markdown [value]="content" [components]="customComponents" />
 * ```
 */
@Component({
  selector: 'comark-markdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'contentClass',
    style: 'display: block',
  },
  template: '',
})
export class Markdown extends MarkdownRenderBase {
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

  /** If document has a <!-- more --> comment, only render content before it */
  readonly summary = input<boolean>(false)

  /**
   * Signal backing for {@link document}.
   *
   * Parsing resolves asynchronously, so the parsed document must be reactive for
   * the render effect to pick it up; a plain field would only be seen by chance.
   */
  private readonly parsedDocument = signal<MarkdownDocumentType | null>(null)

  /** The parsed document (or the pre-parsed document passed as `value`). */
  get document(): MarkdownDocumentType | null {
    return this.parsedDocument()
  }

  set document(value: MarkdownDocumentType | null) {
    this.parsedDocument.set(value)
  }

  protected override get renderDocument(): MarkdownDocumentType | null {
    return this.parsedDocument()
  }

  /** Config-level and instance-level components merged, instance wins. */
  private readonly mergedComponents = computed(() => ({ ...(this.config?.components ?? {}), ...this.components() }))

  protected override get componentsMap(): Record<string, Type<any>> {
    return this.mergedComponents()
  }

  get contentClass(): string {
    return ['comark-content', this.config?.class].filter(Boolean).join(' ')
  }

  private serializedParse = createSerializedMarkdownParser({})

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
      this.syncLiveDocument()
      return
    }

    let source = (this.value() as string | undefined) ?? ''
    if (this.summary()) {
      source = source.split('<!-- more -->')[0] || ''
    }
    source = source.trim()

    this.serializedParse(source, { streaming: this.streaming() }).then((result) => {
      this.document = result
      this.syncLiveDocument()
    })
  }
}

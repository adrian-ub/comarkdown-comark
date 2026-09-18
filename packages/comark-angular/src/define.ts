import type { Provider, Type } from '@angular/core'
import type { ParserOptions } from 'comark'
import { MARKDOWN_CONFIG, MARKDOWN_DOCUMENT_CONFIG } from './config'
import type { MarkdownConfig, MarkdownDocumentConfig } from './config'

export interface DefineMarkdownComponentOptions extends ParserOptions {
  /** Pre-configured component mappings. */
  components?: Record<string, Type<any>>
  /** Additional CSS class for the wrapper. */
  class?: string
}

export interface DefineMarkdownDocumentOptions {
  /** Pre-configured component mappings. */
  components?: Record<string, Type<any>>
  /** Additional CSS class for the wrapper. */
  class?: string
}

/**
 * Create a pre-configured Markdown config provider.
 *
 * Returns an Angular `Provider` for `MARKDOWN_CONFIG` that the static
 * `Markdown` component reads via `inject(MARKDOWN_CONFIG, { optional: true })`,
 * merging config-level defaults (parse options, plugins, components, class)
 * with any per-instance inputs at runtime.
 *
 * The provider is fully AOT-safe — unlike factory-created component classes,
 * which ngtsc cannot statically evaluate when placed in another component's
 * `imports`.
 *
 * @example
 * ```typescript
 * import { Component } from '@angular/core'
 * import { Markdown, defineMarkdownComponent } from '@comark/angular'
 * import { math, Math } from '@comark/angular/plugins/math'
 *
 * @Component({
 *   selector: 'app-docs',
 *   standalone: true,
 *   imports: [Markdown],
 *   providers: [
 *     defineMarkdownComponent({
 *       plugins: [math()],
 *       components: { Math },
 *       class: 'prose dark:prose-invert',
 *     }),
 *   ],
 *   template: `<comark-markdown [value]="content" />`,
 * })
 * export class DocsComponent {
 *   content = '# Hello'
 * }
 * ```
 */
export function defineMarkdownComponent(config: DefineMarkdownComponentOptions = {}): Provider {
  const { components: configComponents = {}, class: configClass, plugins: configPlugins = [], ...parseOptions } = config

  return {
    provide: MARKDOWN_CONFIG,
    useValue: {
      options: parseOptions,
      plugins: configPlugins,
      components: configComponents,
      class: configClass,
    } satisfies MarkdownConfig,
  }
}

/**
 * Create a pre-configured MarkdownDocument config provider.
 *
 * Returns an Angular `Provider` for `MARKDOWN_DOCUMENT_CONFIG` that the static
 * `MarkdownDocument` component reads via
 * `inject(MARKDOWN_DOCUMENT_CONFIG, { optional: true })`, merging
 * config-level component mappings and class with per-instance inputs.
 *
 * @example
 * ```typescript
 * import { Component } from '@angular/core'
 * import { MarkdownDocument, defineMarkdownDocumentComponent } from '@comark/angular'
 * import { Math } from '@comark/angular/plugins/math'
 *
 * @Component({
 *   selector: 'app-docs',
 *   standalone: true,
 *   imports: [MarkdownDocument],
 *   providers: [
 *     defineMarkdownDocumentComponent({
 *       components: { Math },
 *     }),
 *   ],
 *   template: `<comark-markdown-document [value]="document" />`,
 * })
 * export class DocsComponent {}
 * ```
 */
export function defineMarkdownDocumentComponent(config: DefineMarkdownDocumentOptions = {}): Provider {
  const { components: configComponents = {}, class: configClass } = config

  return {
    provide: MARKDOWN_DOCUMENT_CONFIG,
    useValue: {
      components: configComponents,
      class: configClass,
    } satisfies MarkdownDocumentConfig,
  }
}

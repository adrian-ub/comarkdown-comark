import {
  ApplicationRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  Injector,
  Renderer2,
  createComponent,
  effect,
  inject,
  input,
  reflectComponentType,
  signal,
  untracked,
  type ComponentRef,
  type OnDestroy,
  type OnInit,
  type Type,
} from '@angular/core'
import type {
  ElementNode,
  MarkdownDocument as MarkdownDocumentType,
  Node as MarkdownAstNode,
  NodeRenderData,
} from 'comark'
import { resolveIfWrapper, selectIfBranch, shouldRenderIf, type IfProps } from 'comark/plugins/binding'
import { pascalCase, resolveAttributes } from 'comark/utils'
import { findLastTextNodeAndAppendNode, getCaret } from '../utils/caret'

const EMPTY_DOCUMENT: MarkdownDocumentType = { nodes: [], frontmatter: {}, meta: {} }

interface StructuralComponent extends Type<any> {
  ɵcomarkIf?: boolean
}

/**
 * Helper to get tag from a Node
 */
function getTag(node: MarkdownAstNode): string | null {
  if (Array.isArray(node) && node.length >= 1) {
    return node[0] as string
  }
  return null
}

/**
 * Helper to get props from a Node
 */
function getProps(node: MarkdownAstNode): Record<string, any> {
  if (Array.isArray(node) && node.length >= 2) {
    return (node[1] as Record<string, any>) || {}
  }
  return {}
}

/**
 * Helper to get children from a Node
 */
function getChildren(node: MarkdownAstNode): MarkdownAstNode[] {
  if (Array.isArray(node) && node.length > 2) {
    return node.slice(2) as MarkdownAstNode[]
  }
  return []
}

/**
 * Resolve a custom component from the components map.
 */
function resolveComponent(tag: string, components: Record<string, Type<any>>): Type<any> | undefined {
  const pascalTag = pascalCase(tag)
  const proseTag = `Prose${pascalTag}`
  return components[proseTag] || components[pascalTag] || components[tag]
}

/** Void (self-closing) HTML elements that must not have children. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/**
 * Shared render engine for every Comark Angular renderer.
 *
 * Holds the DOM rendering logic (native elements, custom components, `::if`
 * branches, slots) and, for subclasses that opt in via {@link autoRender}, keeps
 * the host element in sync with the current document.
 *
 * The host element is the output target: there is no intermediate wrapper
 * element between a renderer and the markdown it produces. `Markdown` and
 * `MarkdownDocument` therefore ship an empty template and write into their own
 * host, which is why the documentation's `.comark-content` wrapper is the custom
 * element itself.
 *
 * The `@Directive()` decorator exists only because Angular requires a decorated
 * class to host `input()` signals that subclasses inherit; this class is abstract
 * and never instantiated on its own.
 */
@Directive()
export abstract class MarkdownRenderBase implements OnInit, OnDestroy {
  /** Custom component mappings for element tags */
  readonly components = input<Record<string, Type<any>>>({})

  /** Enable streaming mode */
  readonly streaming = input<boolean>(false)

  /** Append a caret to the last text node (for streaming UIs) */
  readonly caret = input<boolean | { class: string }>(false)

  /** Additional data to pass to the renderer for :binding resolution */
  readonly data = input<Record<string, unknown>>({})

  /**
   * Document key used to subscribe to live updates via `globalThis.comarkContext`.
   * Falls back to the document's own `meta.key` when set by a plugin.
   */
  readonly documentKey = input<string>()

  protected readonly elementRef = inject(ElementRef)
  protected readonly renderer = inject(Renderer2)

  private readonly injector = inject(Injector)
  private readonly appRef = inject(ApplicationRef)

  private readonly liveDocument = signal<MarkdownDocumentType | null>(null)
  private cleanup?: (clear?: boolean) => void
  private liveKey: string | undefined

  /** Component views created by the last render, destroyed on the next one. */
  private createdRefs: ComponentRef<any>[] = []

  /** The element markdown is rendered into — the component's own host. */
  protected get host(): HTMLElement {
    return this.elementRef.nativeElement as HTMLElement
  }

  /** The document to render (null while none is ready). */
  protected get renderDocument(): MarkdownDocumentType | null {
    return null
  }

  /**
   * Whether the base keeps the host in sync automatically.
   *
   * Subclasses that own their render timing (rendering from `ngOnChanges`
   * instead of the automatic effect) set this to `false` so the automatic
   * render never runs for them.
   */
  protected get autoRender(): boolean {
    return true
  }

  /**
   * Automatic render into the host element.
   *
   * Reads only signal-backed state — {@link renderedNodes}, {@link contextRenderData}
   * and the components map — so it re-runs on document, caret, streaming, data and
   * components changes, but not on unrelated inputs such as `documentKey`.
   *
   * Timing: this is a *view* effect, so it runs as part of the host view's refresh.
   * The host element always exists by then, and — verified against Angular 22 +
   * `platform-server` — view effects also run during server-side rendering, which
   * makes this the only render path `Markdown`/`MarkdownDocument` need. Every DOM
   * write goes through `Renderer2` so SSR's DOM implementation is supported too.
   */
  private readonly autoRenderEffect = effect(() => {
    if (!this.autoRender) return
    this.renderNodes(this.host, this.renderedNodes)
  })

  ngOnInit(): void {
    this.syncLiveDocument()
  }

  ngOnDestroy(): void {
    this.cleanup?.(true)
    this.destroyCreatedRefs()
  }

  /**
   * (Re)subscribe to `globalThis.comarkContext` for the current document key.
   *
   * Called from `ngOnInit` and again by `Markdown` once an async parse resolves,
   * so a key that only exists on the parsed document (`meta.key`) still wires up.
   * Re-subscribes only when the key actually changes.
   *
   * Deliberately untracked: the automatic render must not depend on `documentKey`,
   * otherwise changing that input would rebuild the whole document tree.
   */
  protected syncLiveDocument(): void {
    const doc = untracked(() => this.renderDocument)
    const key = doc?.meta?.key || untracked(() => this.documentKey())
    if (key === this.liveKey) return

    this.cleanup?.(true)
    this.cleanup = undefined
    this.liveDocument.set(null)
    this.liveKey = key

    if (key && globalThis.comarkContext) {
      this.cleanup = globalThis.comarkContext.get(key, doc ?? EMPTY_DOCUMENT).listen((document) => {
        this.liveDocument.set(document)
      })
    }
  }

  protected get activeDocument(): MarkdownDocumentType {
    return this.liveDocument() ?? this.renderDocument ?? EMPTY_DOCUMENT
  }

  private nodesCache?: {
    document: MarkdownDocumentType
    caret: boolean | { class: string }
    streaming: boolean
    value: MarkdownAstNode[]
  }

  /**
   * The nodes to render.
   *
   * Memoized on document identity and the caret/streaming inputs so the array
   * keeps a stable reference across change-detection cycles — otherwise Angular
   * would see a "new" value on every check and rebuild every dynamic component.
   * `comarkContext` swaps the document object on each update (structural
   * sharing), so identity is a sound cache key.
   */
  protected get renderedNodes(): MarkdownAstNode[] {
    const document = this.activeDocument
    const caret = this.caret()
    const streaming = this.streaming()
    const cache = this.nodesCache
    if (cache && cache.document === document && cache.caret === caret && cache.streaming === streaming) {
      return cache.value
    }

    const nodes = [...(document.nodes || [])]
    const caretNode = getCaret(caret)

    if (streaming && caretNode && nodes.length > 0) {
      const hasStreamCaret = findLastTextNodeAndAppendNode(nodes[nodes.length - 1] as ElementNode, caretNode)
      if (!hasStreamCaret) nodes.push(caretNode)
    }

    this.nodesCache = { document, caret, streaming, value: nodes }
    return nodes
  }

  private renderDataCache?: { document: MarkdownDocumentType; data: Record<string, unknown>; value: NodeRenderData }

  /**
   * Render data for `:binding` resolution, memoized for a stable reference.
   *
   * Subclasses may override it to source the data elsewhere (for example from
   * their own inputs).
   */
  protected get contextRenderData(): NodeRenderData {
    const document = this.activeDocument
    const data = this.data() || {}
    const cache = this.renderDataCache
    if (cache && cache.document === document && cache.data === data) {
      return cache.value
    }

    const value: NodeRenderData = {
      frontmatter: document.frontmatter,
      meta: document.meta,
      data,
      props: {},
    }
    this.renderDataCache = { document, data, value }
    return value
  }

  /**
   * The components map used to resolve tags to custom components.
   *
   * Subclasses merge config-level components under the instance input.
   */
  protected get componentsMap(): Record<string, Type<any>> {
    return this.components()
  }

  /**
   * Render `nodes` into `container`, replacing whatever it held before.
   *
   * Any component view created by the previous render is destroyed first, then
   * the container is emptied, then the nodes are rendered. Everything the engine
   * creates is a direct child of `container` — no wrapper elements.
   *
   * `parentNode` is the owning AST node and is only used for the `<pre>` guard:
   * inside a `pre` element custom components are not resolved. Top-level renders
   * pass no parent.
   */
  protected renderNodes(container: HTMLElement, nodes: MarkdownAstNode[], parentNode?: MarkdownAstNode): void {
    this.destroyCreatedRefs()

    while (container.firstChild) {
      container.removeChild(container.firstChild)
    }

    this.renderChildren(container, nodes, this.contextRenderData, parentNode)
  }

  /**
   * Render an array of Node children into a parent DOM element.
   *
   * Native children are rendered as DOM elements; children mapped to a custom
   * component are instantiated directly into `parentEl` (no wrapper).
   */
  protected renderChildren(
    parentEl: HTMLElement,
    children: MarkdownAstNode[],
    renderData: NodeRenderData,
    parentNode?: MarkdownAstNode
  ): void {
    for (const child of children) {
      if (child === undefined || child === null) continue

      // For text nodes, insert directly
      if (typeof child === 'string') {
        const text = this.renderer.createText(child)
        this.renderer.appendChild(parentEl, text)
        continue
      }

      // For element nodes, resolve custom components and render
      if (Array.isArray(child)) {
        const childTag = getTag(child)
        if (!childTag) continue

        const childProps = getProps(child)
        const grandChildren = getChildren(child)

        // Resolve custom component for this child
        let customComponent: Type<any> | undefined
        if ((parentNode as ElementNode | undefined)?.[0] !== 'pre') {
          if (childProps.as) {
            customComponent = resolveComponent(childProps.as, this.componentsMap)
          }
          if (!customComponent) {
            customComponent = resolveComponent(childTag, this.componentsMap)
          }
        }

        const resolved = resolveAttributes(childProps, renderData, { parseJson: true })
        const hasOwnAttrs = Object.keys(resolved).length > 0
        const childRenderData: NodeRenderData = hasOwnAttrs ? { ...renderData, props: resolved } : renderData

        if ((customComponent as StructuralComponent | undefined)?.ɵcomarkIf) {
          this.renderIf(resolved, grandChildren, childRenderData, parentEl)
        } else if (customComponent) {
          this.renderCustomComponent(customComponent, resolved, grandChildren, childRenderData, parentEl, child)
        } else {
          this.renderNativeEl(parentEl, childTag, resolved, grandChildren, childRenderData)
        }
      }
    }
  }

  /** Create a native DOM element with attributes and children, append to parent. */
  protected renderNativeEl(
    parentEl: HTMLElement,
    tag: string,
    attrs: Record<string, any>,
    children: MarkdownAstNode[],
    childrenRenderData: NodeRenderData
  ): void {
    const el = this.renderer.createElement(tag)
    this.applyAttributes(el, attrs)

    // `innerHTML` from document attributes is never applied — resolveAttributes
    // drops DOM sink props, and raw HTML has its own explicit parse path.
    if (!VOID_ELEMENTS.has(tag)) {
      this.renderChildren(el, children, childrenRenderData, [tag, attrs, ...children])
    }

    this.renderer.appendChild(parentEl, el)
  }

  /** Apply resolved attributes to a DOM element. */
  protected applyAttributes(el: HTMLElement, attrs: Record<string, any>): void {
    for (const key in attrs) {
      const value = attrs[key]
      if (key === 'as' || key === 'innerHTML' || key === 'dangerouslySetInnerHTML') {
        continue
      } else if (key === 'className' || key === 'class') {
        this.renderer.setAttribute(el, 'class', String(value))
      } else if (key === 'style' && typeof value === 'string') {
        this.renderer.setAttribute(el, 'style', value)
      } else if (key === 'tabindex') {
        this.renderer.setAttribute(el, 'tabindex', String(value))
      } else if (typeof value === 'boolean') {
        if (value) this.renderer.setAttribute(el, key, '')
      } else if (value != null) {
        this.renderer.setAttribute(el, key, String(value))
      }
    }
  }

  /** Evaluate an `::if` before rendering any of its descendants. */
  protected renderIf(
    props: IfProps,
    children: MarkdownAstNode[],
    childrenRenderData: NodeRenderData,
    appendTo: HTMLElement
  ): void {
    const branch = selectIfBranch(children, shouldRenderIf(props))
    if (!branch) return

    const wrapper = resolveIfWrapper(props.as)
    if (wrapper) {
      this.renderNativeEl(appendTo, wrapper, {}, branch, childrenRenderData)
    } else {
      this.renderChildren(appendTo, branch, childrenRenderData)
    }
  }

  /**
   * Instantiate a custom component and insert it directly into `appendTo`.
   *
   * Children are pre-rendered into a detached container and passed as
   * `projectableNodes`, so they are available to `<ng-content />`. Named slots are
   * rendered into `slot`-marked containers on the component host. The component
   * view is attached to the application so it takes part in change detection.
   */
  protected renderCustomComponent(
    componentType: Type<any>,
    attrs: Record<string, any>,
    children: MarkdownAstNode[],
    childrenRenderData: NodeRenderData,
    appendTo: HTMLElement,
    currentNode: MarkdownAstNode
  ): void {
    // Separate slots from regular children
    const slots: Record<string, MarkdownAstNode[]> = {}
    const regularChildren: MarkdownAstNode[] = []

    for (const child of children) {
      if (child === undefined || child === null) continue

      const childTag = getTag(child)
      const childProps = getProps(child)

      if (childTag === 'template' && childProps) {
        let slotName: string | undefined

        if (childProps.name) {
          slotName = childProps.name
        } else {
          for (const pk in childProps) {
            if (pk.startsWith('v-slot:') || pk.startsWith('#')) {
              slotName = pk.startsWith('#') ? pk.substring(1) : pk.substring(7)
              break
            }
          }
        }

        if (slotName) {
          slots[slotName] = getChildren(child)
          continue
        }
      }

      regularChildren.push(child)
    }

    // Pre-render children into a temporary container so we can pass them as
    // projectableNodes for Angular's <ng-content /> content projection
    const tempContainer = this.renderer.createElement('div')

    // Render regular children
    if (regularChildren.length > 0) {
      this.renderChildren(tempContainer, regularChildren, childrenRenderData, currentNode)
    }

    // Render named slot "default" children too
    if (slots['default']) {
      this.renderChildren(tempContainer, slots['default'], childrenRenderData, currentNode)
    }

    // Collect all rendered child nodes for the default slot
    const defaultSlotNodes: Node[] = Array.from(tempContainer.childNodes)

    // Build projectableNodes array - index 0 is the default <ng-content />
    const projectableNodes: Node[][] = [defaultSlotNodes]

    const tagName = getTag(currentNode) || componentType.name

    try {
      // Create the Angular component with projected content
      const componentRef = createComponent(componentType, {
        environmentInjector: this.injector.get(EnvironmentInjector),
        elementInjector: this.injector,
        projectableNodes,
      })

      // Set inputs
      const mirror = reflectComponentType(componentType)
      const inputNames = new Set(mirror?.inputs.map((i) => i.propName) || [])

      for (const key in attrs) {
        if (key === 'as') continue
        if (inputNames.has(key)) {
          componentRef.setInput(key, attrs[key])
        }
      }

      // Pass __node if the component accepts it
      if (inputNames.has('__node')) {
        componentRef.setInput('__node', currentNode)
      }

      // Render non-default named slots into the component's host element
      for (const slotName in slots) {
        if (slotName === 'default') continue
        const slotEl = this.renderer.createElement('div')
        this.renderer.setAttribute(slotEl, 'slot', slotName)
        this.renderer.setStyle(slotEl, 'display', 'contents')
        this.renderChildren(slotEl, slots[slotName], childrenRenderData, currentNode)
        this.renderer.appendChild(componentRef.location.nativeElement, slotEl)
      }

      // Attach to the application and insert directly into the target element —
      // no intermediate wrapper element.
      this.appRef.attachView(componentRef.hostView)
      this.renderer.appendChild(appendTo, componentRef.location.nativeElement)
      componentRef.changeDetectorRef.detectChanges()

      this.createdRefs.push(componentRef)
    } catch (error) {
      console.error(`Failed to render custom component "${tagName}"`, error)
    }
  }

  /** Detach and destroy every component view created by the previous render. */
  private destroyCreatedRefs(): void {
    for (const ref of this.createdRefs) {
      this.appRef.detachView(ref.hostView)
      ref.destroy()
    }
    this.createdRefs = []
  }
}

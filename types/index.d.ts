// Type definitions for Glassworks.

/** A capture engine adapter. Wrap any rasteriser that can turn an element
 *  into a canvas. */
export interface CaptureEngine {
  /** Engine name, used in logs and in the test record. */
  name: string;
  /** Engine version, when known. */
  version?: string | null;
  /** The underlying library, if the engine wraps one. */
  raw?: unknown;
  /** Rasterise `target` into a canvas. */
  capture:
    | ((
        target: HTMLElement,
        opts: { scale: number; ignore?: (el: Element) => boolean; options?: Record<string, unknown> }
      ) => Promise<HTMLCanvasElement>)
    | null;
}

export interface LensCallbacks {
  /** Fired once per lens, after the first snapshot has been uploaded. */
  init?: (lens: Lens) => void;
}

export interface GlassworksOptions {
  /** CSS selector for the element(s) to turn into glass. Default `.liquidGL`. */
  target?: string;
  /** CSS selector for the element to snapshot. Default `body`. */
  snapshot?: string;
  /** Capture scale. Clamped by the GPU's MAX_TEXTURE_SIZE. Default `2`. */
  resolution?: number;
  refraction?: number;
  bevelDepth?: number;
  bevelWidth?: number;
  frost?: number;
  shadow?: boolean;
  specular?: boolean;
  /** `"fade"` animates the lens in; anything else reveals immediately. */
  reveal?: "fade" | "none" | string;
  tilt?: boolean;
  tiltFactor?: number;
  magnify?: number;
  /**
   * Capture engine: an adapter object, or the name of a registered/global one.
   * Locked at the first call, because the renderer is a per-page singleton.
   * Throws `GlassworksEngineError` when nothing can capture.
   */
  engine?: CaptureEngine | "snapdom" | "html2canvas" | string;
  on?: LensCallbacks;
}

export interface Lens {
  el: HTMLElement;
  options: GlassworksOptions;
  rectPx: { left: number; top: number; width: number; height: number } | null;
  updateMetrics(): void;
  setShadow(enabled: boolean): void;
  setTilt(enabled: boolean): void;
}

export interface Renderer {
  canvas: HTMLCanvasElement;
  lenses: Lens[];
  snapshotTarget: HTMLElement;
  textureWidth: number;
  textureHeight: number;
  scaleFactor: number;
  captureSnapshot(): Promise<boolean | undefined>;
  render(): void;
  addLens(element: HTMLElement, options: GlassworksOptions): Lens;
  addDynamicElement(el: Element | NodeList | Element[] | string): void;
}

export class GlassworksEngineError extends Error {
  name: "GlassworksEngineError";
}

/** Create the glass effect. Returns one lens, or an array when the selector
 *  matched several elements. */
declare function glassworks(options?: GlassworksOptions): Lens | Lens[] | undefined;

declare namespace glassworks {
  /** Register elements that change after load (e.g. animated text). */
  function registerDynamic(elements: Element | NodeList | Element[] | string): void;
  /** Drive rendering from GSAP / Lenis / Locomotive instead of rAF. */
  function syncWith(config?: {
    gsap?: boolean;
    lenis?: unknown;
    locomotiveScroll?: unknown;
  }): { lenis?: unknown; locomotiveScroll?: unknown };
  function registerEngine(name: string, adapter: CaptureEngine): CaptureEngine;
  function getEngine(name: string): CaptureEngine | null;
  function createSnapdomEngine(snapdom: unknown, opts?: { version?: string }): CaptureEngine;
  function createHtml2canvasEngine(html2canvas: unknown, opts?: { version?: string }): CaptureEngine;
  function resolveEngine(requested?: CaptureEngine | string): CaptureEngine | null;
  function capture(
    target: HTMLElement,
    opts: { scale: number; ignore?: (el: Element) => boolean; engine?: CaptureEngine | string }
  ): Promise<HTMLCanvasElement>;
  const version: string;
}

export default glassworks;
export { glassworks };
export function registerEngine(name: string, adapter: CaptureEngine): CaptureEngine;
export function getRegisteredEngine(name: string): CaptureEngine | null;
export function createSnapdomEngine(snapdom: unknown, opts?: { version?: string }): CaptureEngine;
export function createHtml2canvasEngine(html2canvas: unknown, opts?: { version?: string }): CaptureEngine;
export function resolveEngine(requested?: CaptureEngine | string): CaptureEngine | null;
export function captureToCanvas(
  target: HTMLElement,
  opts: {
    scale: number;
    ignore?: (el: Element) => boolean;
    engine?: CaptureEngine | string;
    validateCompleteness?: boolean;
    onEngineFallback?: (next: string) => void;
  }
): Promise<HTMLCanvasElement>;
export const version: string;

declare global {
  interface Window {
    glassworks?: typeof glassworks;
    /** Backwards-compatible alias kept by the UMD build. */
    liquidGL?: typeof glassworks;
    __liquidGLRenderer__?: Renderer;
  }
}

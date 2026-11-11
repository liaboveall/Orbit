"use client";

import { useEffect } from "react";

/**
 * 液态玻璃的两个动态效果，全站只挂载一次（根布局）。
 *
 * 1. 高光跟随指针：把指针位置写到所在玻璃或卡片的 --glass-x / --glass-y。
 * 2. 边缘折射：给带 data-lens 的玻璃生成一张位移贴图，边缘像凸透镜一样把背后的
 *    内容向内弯折。只有 Chromium 能把 SVG 滤镜用在 backdrop-filter 上，其它浏览器
 *    保持 glass.css 里的普通模糊。
 *
 * 两者都是渐进增强：触屏、减少动态效果或降低透明度时不启用对应效果。
 */

const LIGHT_SURFACES = ".glass, .surface-card";
const SVG_NS = "http://www.w3.org/2000/svg";
/** 透镜里对背景的基础模糊（标准差，像素）。元素可用 --lens-blur 覆盖。 */
const LENS_BLUR = 6;
/** 边缘最大位移相对透镜带宽度的倍数；大于 1 时最外缘出现被压缩的倒影。 */
const LENS_DEPTH = 1.5;
/** 贴图面积上限：再大的表面折射既看不出来也不值得计算。 */
const LENS_MAX_AREA = 420_000;

function followPointer(): () => void {
  const capable = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!capable.matches || reduced.matches) return () => {};

  let frame = 0;
  let last: PointerEvent | null = null;
  const paint = () => {
    frame = 0;
    if (!last || !(last.target instanceof Element)) return;
    const surface = last.target.closest<HTMLElement>(LIGHT_SURFACES);
    if (!surface) return;
    const box = surface.getBoundingClientRect();
    surface.style.setProperty("--glass-x", `${last.clientX - box.left}px`);
    surface.style.setProperty("--glass-y", `${last.clientY - box.top}px`);
  };
  const move = (event: PointerEvent) => {
    last = event;
    if (!frame) frame = requestAnimationFrame(paint);
  };
  window.addEventListener("pointermove", move, { passive: true });
  return () => {
    window.removeEventListener("pointermove", move);
    if (frame) cancelAnimationFrame(frame);
  };
}

/**
 * 圆角矩形的位移贴图：R、G 通道分别是 x、y 方向的位移，128 为不动。
 * 透镜带内的像素沿边缘法线向内取样，越靠外位移越大。
 */
function displacementMap(width: number, height: number, radius: number, bezel: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(width, height);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  let offset = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - halfWidth;
      const py = y + 0.5 - halfHeight;
      const qx = Math.abs(px) - (halfWidth - radius);
      const qy = Math.abs(py) - (halfHeight - radius);
      let inside: number;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const length = Math.hypot(qx, qy) || 1;
        inside = radius - length;
        nx = (qx / length) * Math.sign(px);
        ny = (qy / length) * Math.sign(py);
      } else if (qx > qy) {
        inside = radius - qx;
        nx = Math.sign(px);
      } else {
        inside = radius - qy;
        ny = Math.sign(py);
      }
      const edge = Math.min(1, Math.max(0, 1 - inside / bezel));
      const strength = edge * edge;
      image.data[offset++] = Math.round(128 - nx * strength * 127);
      image.data[offset++] = Math.round(128 - ny * strength * 127);
      image.data[offset++] = 128;
      image.data[offset++] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function refract(): () => void {
  // 只有 Chromium 暴露 userAgentData，也只有它渲染 backdrop-filter 里的 SVG 滤镜。
  const chromium = "userAgentData" in navigator;
  const opaque = window.matchMedia("(prefers-reduced-transparency: reduce)");
  if (!chromium || opaque.matches || !CSS.supports("backdrop-filter", "url(#lens)")) return () => {};

  const defs = document.createElementNS(SVG_NS, "svg");
  defs.setAttribute("aria-hidden", "true");
  defs.setAttribute("width", "0");
  defs.setAttribute("height", "0");
  defs.style.cssText = "position:fixed;pointer-events:none";
  document.body.append(defs);

  // 相同尺寸的表面共用一个滤镜，按引用计数回收。
  const filters = new Map<string, { id: string; uses: number }>();
  const applied = new Map<HTMLElement, string>();
  let serial = 0;

  const release = (element: HTMLElement) => {
    const key = applied.get(element);
    if (!key) return;
    applied.delete(element);
    element.style.removeProperty("--lens");
    const entry = filters.get(key);
    if (entry && --entry.uses === 0) {
      filters.delete(key);
      defs.querySelector(`#${entry.id}`)?.remove();
    }
  };

  const apply = (element: HTMLElement) => {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (!width || !height || width * height > LENS_MAX_AREA) {
      release(element);
      return;
    }
    const style = getComputedStyle(element);
    const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, width / 2, height / 2);
    const blur = parseFloat(style.getPropertyValue("--lens-blur")) || LENS_BLUR;
    const key = `${width}x${height}r${Math.round(radius)}b${blur}`;
    if (applied.get(element) === key) return;
    release(element);

    let entry = filters.get(key);
    if (!entry) {
      const bezel = Math.min(Math.max(radius, 10), 22, width / 2, height / 2);
      const map = displacementMap(width, height, radius, bezel);
      if (!map) return;
      entry = { id: `orbit-lens-${++serial}`, uses: 0 };
      const filter = document.createElementNS(SVG_NS, "filter");
      filter.id = entry.id;
      for (const [name, value] of Object.entries({
        x: "0",
        y: "0",
        width: String(width),
        height: String(height),
        filterUnits: "userSpaceOnUse",
        primitiveUnits: "userSpaceOnUse",
        "color-interpolation-filters": "sRGB",
      })) {
        filter.setAttribute(name, value);
      }
      filter.innerHTML =
        `<feImage href="${map}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>` +
        `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="soft"/>` +
        `<feDisplacementMap in="soft" in2="map" scale="${bezel * LENS_DEPTH * 2}" xChannelSelector="R" yChannelSelector="G"/>`;
      defs.append(filter);
      filters.set(key, entry);
    }
    entry.uses++;
    applied.set(element, key);
    element.style.setProperty("--lens", `url(#${entry.id})`);
  };

  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) apply(entry.target as HTMLElement);
  });
  const lensesIn = (node: Node): HTMLElement[] => {
    if (!(node instanceof HTMLElement)) return [];
    const found = Array.from(node.querySelectorAll<HTMLElement>("[data-lens]"));
    if (node.matches("[data-lens]")) found.push(node);
    return found;
  };
  const mutation = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        for (const element of lensesIn(node)) {
          resize.unobserve(element);
          release(element);
        }
      }
      for (const node of record.addedNodes) {
        for (const element of lensesIn(node)) resize.observe(element);
      }
    }
  });
  for (const element of lensesIn(document.body)) resize.observe(element);
  mutation.observe(document.body, { childList: true, subtree: true });

  return () => {
    mutation.disconnect();
    resize.disconnect();
    for (const element of [...applied.keys()]) release(element);
    defs.remove();
  };
}

export function LiquidGlass() {
  useEffect(() => {
    const stopLight = followPointer();
    const stopLens = refract();
    return () => {
      stopLight();
      stopLens();
    };
  }, []);
  return null;
}

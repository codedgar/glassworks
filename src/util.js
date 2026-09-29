/* Small shared helpers. */

/* --------------------------------------------------
 *  Utilities
 * ------------------------------------------------*/
export function debounce(fn, wait) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, a), wait);
  };
}

/* --------------------------------------------------
 *  Helper : Effective z-index (highest stacking context)
 * ------------------------------------------------*/
export function effectiveZ(el) {
  let node = el;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (style.position !== "static" && style.zIndex !== "auto") {
      const z = parseInt(style.zIndex, 10);
      if (!isNaN(z)) return z;
    }
    node = node.parentElement;
  }
  return 0;
}

/* --------------------------------------------------
 *  WebGL helpers
 * ------------------------------------------------*/
export function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src.trim());
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("Shader error", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("Program link error", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

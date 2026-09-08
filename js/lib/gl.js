/* =============================================================================
   gl.js — WebGL2 の薄い道具箱（シェーダー・VAO・FBO）
   three.js を持ち込むと 2MB になるので、扉ひとつのために必要な分だけ自前で持つ。
   ============================================================================= */

export function createProgram(gl, vsSrc, fsSrc, name = 'program') {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, name + '.vert');
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, name + '.frag');
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`[gl] link failed (${name}): ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  // uniform の位置を先に全部引いておく（毎フレーム getUniformLocation を呼ばない）
  const uniforms = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const key = info.name.replace(/\[0\]$/, '');
    uniforms[key] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, uniforms };
}

function compile(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[gl] compile failed (${name}): ${log}\n${numbered(src)}`);
  }
  return sh;
}

function numbered(src) {
  return src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join('\n');
}

/**
 * インターリーブ頂点（position 3 / normal 3 / color 3 / uv 2 = 11 float）＋ index の VAO
 */
export function createMesh(gl, { positions, normals, colors, uvs, indices }) {
  const count = positions.length / 3;
  const stride = 11;
  const data = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    data[o] = positions[i * 3]; data[o + 1] = positions[i * 3 + 1]; data[o + 2] = positions[i * 3 + 2];
    data[o + 3] = normals ? normals[i * 3] : 0;
    data[o + 4] = normals ? normals[i * 3 + 1] : 0;
    data[o + 5] = normals ? normals[i * 3 + 2] : 1;
    data[o + 6] = colors ? colors[i * 3] : 1;
    data[o + 7] = colors ? colors[i * 3 + 1] : 1;
    data[o + 8] = colors ? colors[i * 3 + 2] : 1;
    data[o + 9] = uvs ? uvs[i * 2] : 0;
    data[o + 10] = uvs ? uvs[i * 2 + 1] : 0;
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const bytes = stride * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, bytes, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, bytes, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, bytes, 36);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  const idx = indices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: indices.length, type: idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}

export function drawMesh(gl, mesh) {
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
  gl.bindVertexArray(null);
}

/** 画面を覆う三角形1枚（頂点シェーダーで gl_VertexID から作るので VBO 不要） */
export function drawFullscreen(gl, fsVao) {
  gl.bindVertexArray(fsVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** マルチサンプルの描画先 ＋ 解決先テクスチャ */
export function createMsaaTarget(gl, w, h, samples) {
  const fb = gl.createFramebuffer();
  const color = gl.createRenderbuffer();
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, color);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  return { fb, color, depth, w, h, ok, dispose() { gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth); } };
}

/** テクスチャに描く先（背景スナップショット用など） */
export function createTexTarget(gl, w, h, { filter = gl.LINEAR } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { fb, tex, w, h, ok, dispose() { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); } };
}

export function createVideoTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([40, 12, 16, 255, 40, 12, 16, 255, 40, 12, 16, 255, 40, 12, 16, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

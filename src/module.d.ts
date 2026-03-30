declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.wasm' {
  const content: WebAssembly.Module;
  export default content;
}

interface Env {
  // Bindings for Cloudflare Workers
}

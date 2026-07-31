// Vite inlines `?raw` imports as strings in both the SSR main build and Vitest.
declare module '*.proto?raw' {
  const source: string;
  export default source;
}

// The API script sandbox worker is authored as standalone CommonJS and started with
// `new Worker(source, { eval: true })`, so it is inlined the same way.
declare module '*.js?raw' {
  const source: string;
  export default source;
}

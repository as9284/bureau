// Vite inlines `?raw` imports as strings in both the SSR main build and Vitest.
declare module '*.proto?raw' {
  const source: string;
  export default source;
}

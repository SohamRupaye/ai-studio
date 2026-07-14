// Vite asset imports — tsconfig doesn't load vite/client types, so declare
// the module shapes here. ?raw is used for provider logo SVGs, ?url for the
// bundled pdf.js worker script.
declare module "*.svg?raw" {
  const content: string;
  export default content;
}

declare module "*?url" {
  const src: string;
  export default src;
}

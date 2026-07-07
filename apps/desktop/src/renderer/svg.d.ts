// Vite's ?raw imports (used for provider logo SVGs) — tsconfig doesn't load
// vite/client types, so declare the module shape here.
declare module "*.svg?raw" {
  const content: string;
  export default content;
}

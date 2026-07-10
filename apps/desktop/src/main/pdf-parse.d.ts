// pdf-parse ships no types, and we import its library file directly (the
// package index runs a debug harness on load). Declared as untyped; the call
// site casts to the shape it uses.
declare module "pdf-parse/lib/pdf-parse.js";

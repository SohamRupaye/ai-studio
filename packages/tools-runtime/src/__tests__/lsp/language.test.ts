import { describe, it, expect } from "vitest";
import { getLanguageId, LANGUAGE_EXTENSIONS } from "../../lsp/language.js";

describe("LANGUAGE_EXTENSIONS", () => {
  it("has more than 50 entries", () => {
    expect(Object.keys(LANGUAGE_EXTENSIONS).length).toBeGreaterThan(50);
  });

  it("all keys start with a dot", () => {
    for (const key of Object.keys(LANGUAGE_EXTENSIONS)) {
      expect(key.startsWith("."), `Key "${key}" should start with "."`).toBe(true);
    }
  });

  it("all values are non-empty strings", () => {
    for (const [ext, lang] of Object.entries(LANGUAGE_EXTENSIONS)) {
      expect(typeof lang, `${ext} value should be string`).toBe("string");
      expect(lang.length, `${ext} value should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("maps .json to json", () => {
    expect(LANGUAGE_EXTENSIONS[".json"]).toBe("json");
  });

  it("maps .yaml to yaml", () => {
    expect(LANGUAGE_EXTENSIONS[".yaml"]).toBe("yaml");
  });

  it("maps .md to markdown", () => {
    expect(LANGUAGE_EXTENSIONS[".md"]).toBe("markdown");
  });
});

describe("getLanguageId", () => {
  describe("TypeScript / JavaScript", () => {
    it('"foo.ts" → "typescript"', () => {
      expect(getLanguageId("foo.ts")).toBe("typescript");
    });

    it('"Component.tsx" → "typescriptreact"', () => {
      expect(getLanguageId("Component.tsx")).toBe("typescriptreact");
    });

    it('"index.js" → "javascript"', () => {
      expect(getLanguageId("index.js")).toBe("javascript");
    });

    it('"App.jsx" → "javascriptreact"', () => {
      expect(getLanguageId("App.jsx")).toBe("javascriptreact");
    });

    it('"module.mts" → "typescript"', () => {
      expect(getLanguageId("module.mts")).toBe("typescript");
    });

    it('"module.mjs" → "javascript"', () => {
      expect(getLanguageId("module.mjs")).toBe("javascript");
    });
  });

  describe("Python", () => {
    it('"main.py" → "python"', () => {
      expect(getLanguageId("main.py")).toBe("python");
    });

    it('"types.pyi" → "python"', () => {
      expect(getLanguageId("types.pyi")).toBe("python");
    });
  });

  describe("Systems languages", () => {
    it('"src/lib.rs" → "rust" (path with directory)', () => {
      expect(getLanguageId("src/lib.rs")).toBe("rust");
    });

    it('"main.go" → "go"', () => {
      expect(getLanguageId("main.go")).toBe("go");
    });

    it('"Main.java" → "java"', () => {
      expect(getLanguageId("Main.java")).toBe("java");
    });

    it('"main.c" → "c"', () => {
      expect(getLanguageId("main.c")).toBe("c");
    });

    it('"app.cpp" → "cpp"', () => {
      expect(getLanguageId("app.cpp")).toBe("cpp");
    });
  });

  describe("Web languages", () => {
    it('"index.html" → "html"', () => {
      expect(getLanguageId("index.html")).toBe("html");
    });

    it('"style.css" → "css"', () => {
      expect(getLanguageId("style.css")).toBe("css");
    });

    it('"theme.scss" → "scss"', () => {
      expect(getLanguageId("theme.scss")).toBe("scss");
    });
  });

  describe("Config and data formats", () => {
    it('"package.json" → "json"', () => {
      expect(getLanguageId("package.json")).toBe("json");
    });

    it('"config.yaml" → "yaml"', () => {
      expect(getLanguageId("config.yaml")).toBe("yaml");
    });

    it('"config.yml" → "yaml"', () => {
      expect(getLanguageId("config.yml")).toBe("yaml");
    });

    it('"Cargo.toml" → "toml"', () => {
      expect(getLanguageId("Cargo.toml")).toBe("toml");
    });

    it('"README.md" → "markdown"', () => {
      expect(getLanguageId("README.md")).toBe("markdown");
    });

    it('"schema.graphql" → "graphql"', () => {
      expect(getLanguageId("schema.graphql")).toBe("graphql");
    });

    it('"schema.sql" → "sql"', () => {
      expect(getLanguageId("schema.sql")).toBe("sql");
    });
  });

  describe("Case insensitivity", () => {
    it('"style.CSS" (uppercase) → "css" (case-insensitive)', () => {
      expect(getLanguageId("style.CSS")).toBe("css");
    });

    it('"Main.PY" → "python" (case-insensitive)', () => {
      expect(getLanguageId("Main.PY")).toBe("python");
    });

    it('"Component.TSX" → "typescriptreact" (case-insensitive)', () => {
      expect(getLanguageId("Component.TSX")).toBe("typescriptreact");
    });

    it('"README.MD" → "markdown" (case-insensitive)', () => {
      expect(getLanguageId("README.MD")).toBe("markdown");
    });
  });

  describe("Unknown and missing extensions", () => {
    it('"unknown.xyz" → undefined', () => {
      expect(getLanguageId("unknown.xyz")).toBeUndefined();
    });

    it('"noextension" (no dot) → undefined', () => {
      expect(getLanguageId("noextension")).toBeUndefined();
    });

    it('"file.abc123" → undefined', () => {
      expect(getLanguageId("file.abc123")).toBeUndefined();
    });

    it('"" (empty string) → undefined', () => {
      expect(getLanguageId("")).toBeUndefined();
    });
  });

  describe("Paths with directories", () => {
    it('"packages/ui/src/Button.tsx" → "typescriptreact"', () => {
      expect(getLanguageId("packages/ui/src/Button.tsx")).toBe("typescriptreact");
    });

    it('"src/main.rs" → "rust"', () => {
      expect(getLanguageId("src/main.rs")).toBe("rust");
    });

    it('"/absolute/path/to/script.py" → "python"', () => {
      expect(getLanguageId("/absolute/path/to/script.py")).toBe("python");
    });
  });

  describe("Other languages", () => {
    it('"main.kt" → "kotlin"', () => {
      expect(getLanguageId("main.kt")).toBe("kotlin");
    });

    it('"app.rb" → "ruby"', () => {
      expect(getLanguageId("app.rb")).toBe("ruby");
    });

    it('"app.swift" → "swift"', () => {
      expect(getLanguageId("app.swift")).toBe("swift");
    });

    it('"main.dart" → "dart"', () => {
      expect(getLanguageId("main.dart")).toBe("dart");
    });

    it('"main.zig" → "zig"', () => {
      expect(getLanguageId("main.zig")).toBe("zig");
    });

    it('"model.prisma" → "prisma"', () => {
      expect(getLanguageId("model.prisma")).toBe("prisma");
    });

    it('"main.tf" → "terraform"', () => {
      expect(getLanguageId("main.tf")).toBe("terraform");
    });

    it('"main.sh" → "shellscript"', () => {
      expect(getLanguageId("main.sh")).toBe("shellscript");
    });
  });
});

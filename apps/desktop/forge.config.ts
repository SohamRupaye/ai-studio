import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: "**/*.node",
    },
    name: "Squirl",
    executableName: "squirl",
    // Path without extension: Forge picks icon.icns (macOS) / icon.ico (Windows).
    icon: "./assets/icon",
  },
  makers: [
    new MakerSquirrel({
      name: "squirl",
      authors: "Soham Rupaye",
      exe: "squirl.exe",
      setupExe: "Squirl-Setup.exe",
      setupIcon: "./assets/icon.ico",
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG(),
    new MakerDeb({
      options: {
        name: "squirl",
        bin: "squirl",
        productName: "Squirl",
        maintainer: "Soham Rupaye",
        homepage: "https://github.com/SohamRupaye/ai-studio",
        icon: "./assets/icon.png",
      },
    }),
    new MakerRpm({
      options: {
        name: "squirl",
        bin: "squirl",
        productName: "Squirl",
        license: "MIT",
        homepage: "https://github.com/SohamRupaye/ai-studio",
        icon: "./assets/icon.png",
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;

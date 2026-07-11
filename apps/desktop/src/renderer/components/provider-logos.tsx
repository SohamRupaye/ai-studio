// Provider marks (lobehub static SVGs) inlined at build time. Mono variants
// are fill="currentColor" and inherit the tile's state tone; brands that ship
// a color variant show it while the row is hovered or the provider is active
// — brand color as a state/interaction signal, never at rest.
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import gemini from "@lobehub/icons-static-svg/icons/gemini.svg?raw";
import geminiColor from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg?raw";
import groq from "@lobehub/icons-static-svg/icons/groq.svg?raw";
import mistral from "@lobehub/icons-static-svg/icons/mistral.svg?raw";
import mistralColor from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek.svg?raw";
import deepseekColor from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?raw";
import together from "@lobehub/icons-static-svg/icons/together.svg?raw";
import togetherColor from "@lobehub/icons-static-svg/icons/together-color.svg?raw";
import fireworks from "@lobehub/icons-static-svg/icons/fireworks.svg?raw";
import fireworksColor from "@lobehub/icons-static-svg/icons/fireworks-color.svg?raw";
import cerebras from "@lobehub/icons-static-svg/icons/cerebras.svg?raw";
import cerebrasColor from "@lobehub/icons-static-svg/icons/cerebras-color.svg?raw";
import perplexity from "@lobehub/icons-static-svg/icons/perplexity.svg?raw";
import perplexityColor from "@lobehub/icons-static-svg/icons/perplexity-color.svg?raw";
import cohere from "@lobehub/icons-static-svg/icons/cohere.svg?raw";
import cohereColor from "@lobehub/icons-static-svg/icons/cohere-color.svg?raw";
import nvidia from "@lobehub/icons-static-svg/icons/nvidia.svg?raw";
import nvidiaColor from "@lobehub/icons-static-svg/icons/nvidia-color.svg?raw";
import deepinfra from "@lobehub/icons-static-svg/icons/deepinfra.svg?raw";
import deepinfraColor from "@lobehub/icons-static-svg/icons/deepinfra-color.svg?raw";
import alibaba from "@lobehub/icons-static-svg/icons/alibaba.svg?raw";
import alibabaColor from "@lobehub/icons-static-svg/icons/alibaba-color.svg?raw";
import codex from "@lobehub/icons-static-svg/icons/codex.svg?raw";
import codexColor from "@lobehub/icons-static-svg/icons/codex-color.svg?raw";
import notion from "@lobehub/icons-static-svg/icons/notion.svg?raw";
import github from "@lobehub/icons-static-svg/icons/github.svg?raw";
import figma from "@lobehub/icons-static-svg/icons/figma.svg?raw";
import figmaColor from "@lobehub/icons-static-svg/icons/figma-color.svg?raw";
import vercel from "@lobehub/icons-static-svg/icons/vercel.svg?raw";
// MCP service marks missing from lobehub. simple-icons (CC0) ships bare
// single-path SVGs — `si()` below gives them currentColor and drops the
// <title> (it renders as a stray native tooltip inside an aria-hidden tile).
import linearRaw from "simple-icons/icons/linear.svg?raw";
import atlassianRaw from "simple-icons/icons/atlassian.svg?raw";
import asanaRaw from "simple-icons/icons/asana.svg?raw";
import sentryRaw from "simple-icons/icons/sentry.svg?raw";
import stripeRaw from "simple-icons/icons/stripe.svg?raw";
import gmailRaw from "simple-icons/icons/gmail.svg?raw";
import gcalendarRaw from "simple-icons/icons/googlecalendar.svg?raw";
import gdriveRaw from "simple-icons/icons/googledrive.svg?raw";
// Slack and Canva were removed from simple-icons (trademark takedowns), so
// their marks are vendored: Slack is the canonical four-lozenge mark (mono
// derived from it), Canva from the MIT-licensed CoreUI/devicon sets.
import slack from "../assets/brand/slack-mono.svg?raw";
import slackColor from "../assets/brand/slack-color.svg?raw";
import canva from "../assets/brand/canva-mono.svg?raw";
import canvaColor from "../assets/brand/canva-color.svg?raw";
import { cn } from "../lib/utils";

const si = (svg: string) =>
  svg.replace("<svg ", '<svg fill="currentColor" ').replace(/<title>.*?<\/title>/, "");

// Brands without a color entry (Anthropic, OpenAI, xAI, Notion, GitHub…) are
// monochrome marks to begin with — mono-only is faithful, not a gap.
const LOGOS: Record<string, { mono: string; color?: string }> = {
  anthropic: { mono: anthropic },
  openai: { mono: openai },
  google: { mono: gemini, color: geminiColor }, // AI Studio keys drive Gemini
  openrouter: { mono: openrouter },
  groq: { mono: groq },
  mistral: { mono: mistral, color: mistralColor },
  deepseek: { mono: deepseek, color: deepseekColor },
  xai: { mono: xai },
  together: { mono: together, color: togetherColor },
  fireworks: { mono: fireworks, color: fireworksColor },
  cerebras: { mono: cerebras, color: cerebrasColor },
  perplexity: { mono: perplexity, color: perplexityColor },
  cohere: { mono: cohere, color: cohereColor },
  nvidia: { mono: nvidia, color: nvidiaColor },
  deepinfra: { mono: deepinfra, color: deepinfraColor },
  alibaba: { mono: alibaba, color: alibabaColor },
  codex: { mono: codex, color: codexColor },
  // MCP quick-connect services — every preset has a mark; the monogram
  // fallback now only serves custom servers.
  notion: { mono: notion },
  github: { mono: github },
  figma: { mono: figma, color: figmaColor },
  vercel: { mono: vercel },
  linear: { mono: si(linearRaw) },
  atlassian: { mono: si(atlassianRaw) },
  asana: { mono: si(asanaRaw) },
  sentry: { mono: si(sentryRaw) },
  stripe: { mono: si(stripeRaw) },
  slack: { mono: slack, color: slackColor },
  canva: { mono: canva, color: canvaColor },
  gmail: { mono: si(gmailRaw) },
  calendar: { mono: si(gcalendarRaw) },
  drive: { mono: si(gdriveRaw) },
};

function Svg({ svg, className }: { svg: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("items-center justify-center [&>svg]:size-4", className)}
      // Static, bundled, first-party SVGs — no user content flows through here.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * The standard provider tile: neutral, raised when active. The mark renders
 * mono in the tile's tone; brands with a color variant switch to it while
 * active, or while the enclosing `group/row` element is hovered.
 */
export function ProviderTile({
  provider,
  monogram,
  active,
  className,
  iconClassName,
}: {
  provider?: string;
  monogram: string;
  active: boolean;
  className?: string;
  iconClassName?: string;
}) {
  const logo = provider ? LOGOS[provider] : undefined;

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border text-label-md font-semibold",
        active
          ? "border-line-strong bg-surface-2 text-fg shadow-raised"
          : "border-line bg-surface-1 text-fg-subtle group-hover/row:border-line-strong group-hover/row:bg-surface-2 group-hover/row:text-fg",
        className ?? "size-8",
      )}
    >
      {!logo ? (
        monogram
      ) : !logo.color ? (
        <Svg svg={logo.mono} className={cn("flex", iconClassName)} />
      ) : active ? (
        <Svg svg={logo.color} className={cn("flex", iconClassName)} />
      ) : (
        <>
          <Svg svg={logo.mono} className={cn("flex group-hover/row:hidden", iconClassName)} />
          <Svg svg={logo.color} className={cn("hidden group-hover/row:flex", iconClassName)} />
        </>
      )}
    </span>
  );
}

export function hasProviderLogo(provider: string): boolean {
  return provider in LOGOS;
}

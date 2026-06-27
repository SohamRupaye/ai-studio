import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../components/ui/card";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "../components/ui/form";
import { useAuth } from "../components/auth-provider";

// ── Schema ───────────────────────────────────────────────────────────────────

/** All key-based providers the backend router supports (see packages/providers/src/config.ts). */
const CORE_PROVIDERS = [
  {
    key: "anthropic" as const,
    label: "Anthropic",
    placeholder: "sk-ant-...",
    description: "For Claude Sonnet, Haiku, and Opus models",
  },
  {
    key: "openai" as const,
    label: "OpenAI",
    placeholder: "sk-...",
    description: "For GPT-4o, o3, o4-mini models",
  },
  {
    key: "google" as const,
    label: "Google AI",
    placeholder: "AIza...",
    description: "For Gemini 2.5 Pro and Flash models",
  },
];

const MORE_PROVIDERS = [
  { key: "openrouter" as const, label: "OpenRouter", placeholder: "sk-or-...", description: "Free + aggregated models" },
  { key: "groq" as const, label: "Groq", placeholder: "gsk_...", description: "Llama, GPT-OSS (fast inference)" },
  { key: "mistral" as const, label: "Mistral", placeholder: "...", description: "Mistral, Codestral, Magistral" },
  { key: "deepseek" as const, label: "DeepSeek", placeholder: "sk-...", description: "DeepSeek Chat, Reasoner" },
  { key: "xai" as const, label: "xAI", placeholder: "xai-...", description: "Grok models" },
  { key: "together" as const, label: "Together AI", placeholder: "...", description: "Llama, DeepSeek, Qwen" },
  { key: "fireworks" as const, label: "Fireworks", placeholder: "fw_...", description: "Llama, DeepSeek" },
  { key: "cerebras" as const, label: "Cerebras", placeholder: "csk-...", description: "Llama, Qwen (fast inference)" },
  { key: "perplexity" as const, label: "Perplexity", placeholder: "pplx-...", description: "Sonar models" },
  { key: "cohere" as const, label: "Cohere", placeholder: "...", description: "Command models" },
  { key: "nvidia" as const, label: "NVIDIA NIM", placeholder: "nvapi-...", description: "Llama, Qwen Coder" },
  { key: "deepinfra" as const, label: "DeepInfra", placeholder: "...", description: "Llama, Qwen" },
  { key: "alibaba" as const, label: "Alibaba (DashScope)", placeholder: "sk-...", description: "Qwen models" },
];

const ALL_PROVIDERS = [...CORE_PROVIDERS, ...MORE_PROVIDERS];

const apiKeysSchema = z.object(
  Object.fromEntries(ALL_PROVIDERS.map((p) => [p.key, z.string().optional()])) as Record<
    (typeof ALL_PROVIDERS)[number]["key"],
    z.ZodOptional<z.ZodString>
  >,
).refine(
  (data) => Object.values(data).some((v) => !!v),
  { message: "At least one API key is required", path: ["anthropic"] }
);

type ApiKeysForm = z.infer<typeof apiKeysSchema>;

// Quiet sentence-case labels (overrides the mono/uppercase Label default).
const labelClass = "font-sans text-[13px] font-medium normal-case tracking-normal text-foreground";

// ── Component ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [showMore, setShowMore] = useState(false);

  const form = useForm<ApiKeysForm>({
    resolver: zodResolver(apiKeysSchema),
    defaultValues: Object.fromEntries(ALL_PROVIDERS.map((p) => [p.key, ""])) as ApiKeysForm,
  });

  const toggleVisibility = (key: string) => {
    setVisibleKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const onSubmit = async (data: ApiKeysForm) => {
    setIsSubmitting(true);
    try {
      // Save API keys via config:set
      // The backend reloads config and re-initializes the router
      await window.ipc.invoke("config:set", {
        apiKeys: Object.fromEntries(ALL_PROVIDERS.map((p) => [p.key, data[p.key] || ""])),
      });

      // Re-check auth state
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      console.error("[login] Failed to save config:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-lg px-6">
      <div className="mb-6 text-center">
        <span className="text-sm font-semibold text-foreground">AI Studio</span>
      </div>

      <Card className="rounded-2xl shadow-lg">
        <CardHeader className="p-8 pb-0">
          <CardTitle>Connect AI providers</CardTitle>
          <CardDescription>Add at least one API key to start using AI Studio.</CardDescription>
        </CardHeader>

        <CardContent className="p-8">
          <p className="mb-6 rounded-lg border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
            <strong className="font-medium text-foreground">Codex (GPT-5)</strong> is available by default via OAuth — no key needed.
            Add provider keys below for additional models.
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" id="api-keys-form">
              {CORE_PROVIDERS.map((provider) => (
                <FormField
                  key={provider.key}
                  control={form.control}
                  name={provider.key}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>{provider.label}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={visibleKeys[provider.key] ? "text" : "password"}
                            placeholder={provider.placeholder}
                            className="pr-10"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => toggleVisibility(provider.key)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            {visibleKeys[provider.key]
                              ? <EyeOff className="h-4 w-4" />
                              : <Eye className="h-4 w-4" />
                            }
                          </button>
                        </div>
                      </FormControl>
                      <FormDescription>{provider.description}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}

              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showMore ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showMore ? "Hide" : "Show"} {MORE_PROVIDERS.length} more providers
              </button>

              {showMore && (
                <div className="space-y-4 border-t border-border/70 pt-4">
                  {MORE_PROVIDERS.map((provider) => (
                    <FormField
                      key={provider.key}
                      control={form.control}
                      name={provider.key}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={labelClass}>{provider.label}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                {...field}
                                type={visibleKeys[provider.key] ? "text" : "password"}
                                placeholder={provider.placeholder}
                                className="pr-10"
                                autoComplete="off"
                              />
                              <button
                                type="button"
                                onClick={() => toggleVisibility(provider.key)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                              >
                                {visibleKeys[provider.key]
                                  ? <EyeOff className="h-4 w-4" />
                                  : <Eye className="h-4 w-4" />
                                }
                              </button>
                            </div>
                          </FormControl>
                          <FormDescription>{provider.description}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              )}
            </form>
          </Form>
        </CardContent>

        <CardFooter className="flex justify-between p-8 pt-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Skip — rely on Codex OAuth only
              refresh().then(() => navigate("/", { replace: true }));
            }}
          >
            Skip for now
          </Button>
          <Button type="button" onClick={form.handleSubmit(onSubmit)} disabled={isSubmitting}>
            {isSubmitting ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
            ) : (
              "Save and continue"
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

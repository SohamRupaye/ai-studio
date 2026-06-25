import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { User, FolderOpen, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../components/ui/card";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "../components/ui/form";
import { useAuth } from "../components/auth-provider";
import { toast } from "sonner";

// ── Schema ───────────────────────────────────────────────────────────────────

const onboardingSchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name too long"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  orgName: z.string().min(1, "Organization name is required").max(50, "Name too long"),
  projectName: z.string().min(1, "Project name is required").max(50, "Name too long"),
});

type OnboardingForm = z.infer<typeof onboardingSchema>;

// Quiet sentence-case labels (overrides the mono/uppercase Label default).
const labelClass = "font-sans text-[13px] font-medium normal-case tracking-normal text-foreground";

// ── Component ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const form = useForm<OnboardingForm>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { name: "", email: "", orgName: "Personal", projectName: "My First Project" },
  });

  const onSubmit = async (data: OnboardingForm) => {
    setIsSubmitting(true);
    try {
      // 1. Create user
      await window.ipc.invoke("user:set", {
        name: data.name,
        email: data.email || undefined,
      });

      // 2. Create organization
      const org = await window.ipc.invoke("org:create", { name: data.orgName });

      // 3. Create first project
      await window.ipc.invoke("project:create", { orgId: org.id, name: data.projectName });

      // 4. Persist selection so the workspace opens on the new org/project
      localStorage.setItem("ai-studio:active-org", org.id);
      localStorage.removeItem("ai-studio:active-project");

      // 5. Refresh auth state, then enter the app
      await refresh();
      toast.success("Workspace created");
      navigate("/", { replace: true });
    } catch (err) {
      console.error("[onboarding] Failed:", err);
      toast.error(`Could not create workspace: ${(err as Error).message}`);
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
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Welcome to AI Studio</CardTitle>
              <CardDescription>Set up your workspace in seconds.</CardDescription>
            </div>
            <span className="mt-1 shrink-0 text-xs tabular-nums text-muted-foreground">
              Step {step} of 2
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" id="onboarding-form">
              {step === 1 && (
                <>
                  <div className="flex items-center gap-2 pb-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">About you</span>
                  </div>

                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={labelClass}>Your name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="What should we call you?" autoFocus />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={labelClass}>Email (optional)</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" placeholder="you@example.com" />
                        </FormControl>
                        <FormDescription>Used for avatar generation only</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {step === 2 && (
                <>
                  <div className="flex items-center gap-2 pb-2">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Your workspace</span>
                  </div>

                  <FormField
                    control={form.control}
                    name="orgName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={labelClass}>Organization</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Personal" autoFocus />
                        </FormControl>
                        <FormDescription>Group projects under an org (e.g., your team or company)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="projectName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={labelClass}>First project</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="My First Project" />
                        </FormControl>
                        <FormDescription>You can rename or add more projects later</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </form>
          </Form>
        </CardContent>

        <CardFooter className="flex justify-between p-8 pt-0">
          {step === 2 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              Back
            </Button>
          ) : (
            <div />
          )}

          {step === 1 ? (
            <Button
              onClick={async () => {
                // Validate step 1 fields before advancing
                const valid = await form.trigger(["name", "email"]);
                if (valid) setStep(2);
              }}
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={form.handleSubmit(onSubmit, (errors) => {
                const first = Object.values(errors)[0];
                const msg = (first?.message as string) || "Please complete all required fields";
                toast.error(msg);
                // If a step-1 field is the problem, jump back so the user can fix it.
                if (errors.name || errors.email) setStep(1);
              })}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              ) : (
                <>
                  Create workspace
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

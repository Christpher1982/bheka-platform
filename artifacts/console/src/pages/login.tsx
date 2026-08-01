import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/states";
import { devLogin } from "@/api/resources";
import { SESSION_QUERY_KEY } from "@/lib/session";

const SEEDED_ADMIN_EMAIL = "admin@eride-technologies.test";

export function LoginPage() {
  const [email, setEmail] = useState(SEEDED_ADMIN_EMAIL);
  const queryClient = useQueryClient();

  const login = useMutation({
    mutationFn: () => devLogin(email.trim()),
    // Refetching the session flips App over to the shell; no manual redirect.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <div className="flex h-full items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="size-5" />
            <CardTitle>Bheka Console</CardTitle>
          </div>
          <CardDescription>
            Development sign-in. This form posts to
            <span className="mx-1 font-mono text-xs">/v1/auth/dev-login</span>,
            which exists only while the API server runs with
            <span className="mx-1 font-mono text-xs">NODE_ENV=development</span>.
            Real OIDC sign-in is tracked separately and will replace this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The dev seed creates{" "}
                <span className="font-mono">{SEEDED_ADMIN_EMAIL}</span>.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          {login.error ? <ErrorState error={login.error} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ChevronLeft, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app-shell";
import { ErrorState } from "@/components/states";
import { createCase, listUsers } from "@/api/resources";
import { useSession } from "@/lib/session";
import { fullName } from "@/lib/format";

// POST /v1/cases is gated by requireRole("security_administrator", "investigator").
const REQUIRED_ROLES = ["security_administrator", "investigator"];

export function NewCasePage() {
  const session = useSession();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [subjectUserId, setSubjectUserId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // The subject must be an existing user in the tenant, so offer the roster
  // rather than asking for a UUID by hand.
  const usersQuery = useQuery({
    queryKey: ["users", undefined],
    queryFn: () => listUsers({ limit: 200 }),
  });

  const create = useMutation({
    mutationFn: () =>
      createCase({
        subjectUserId,
        title: title.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (kase) => {
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
      navigate(`/cases/${kase.id}`);
    },
  });

  const canCreate = session.roles.some((role) => REQUIRED_ROLES.includes(role));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <>
      <PageHeader
        title="New case"
        description="Opens a Tier 1 investigation. Escalation to Tier 2 or 3 is a separate, approval-gated workflow."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/cases">
              <ChevronLeft className="size-4" />
              Back to cases
            </Link>
          </Button>
        }
      />
      <div className="max-w-2xl space-y-4 px-6 pb-6">
        {!canCreate ? (
          <Alert>
            <Info className="size-4" />
            <AlertTitle>Your roles cannot open a case</AlertTitle>
            <AlertDescription>
              Opening a case requires{" "}
              <span className="font-mono">security_administrator</span> or{" "}
              <span className="font-mono">investigator</span>. You currently hold{" "}
              <span className="font-mono">
                {session.roles.join(", ") || "no roles"}
              </span>
              , so submitting this form will return 403 Forbidden from the API.
              The form is left enabled so the real response stays visible.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subject">Subject user</Label>
                <Select value={subjectUserId} onValueChange={setSubjectUserId}>
                  <SelectTrigger id="subject">
                    <SelectValue
                      placeholder={
                        usersQuery.isPending
                          ? "Loading users…"
                          : "Select the person under investigation"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(usersQuery.data?.items ?? []).map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {fullName(user)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {usersQuery.error ? <ErrorState error={usersQuery.error} /> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  required
                  maxLength={500}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  rows={5}
                  maxLength={4000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                disabled={create.isPending || !subjectUserId || !title.trim()}
              >
                {create.isPending ? "Creating…" : "Create case"}
              </Button>
            </form>
            {create.error ? <ErrorState error={create.error} /> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

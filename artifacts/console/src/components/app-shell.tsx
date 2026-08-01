import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Briefcase,
  Building2,
  LogOut,
  ShieldCheck,
  Siren,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { logout } from "@/api/resources";
import { useResetSessionCache, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/cases", label: "Cases", icon: Briefcase },
  { href: "/detections", label: "Detections", icon: Siren },
  { href: "/sites", label: "Sites", icon: Building2 },
  { href: "/users", label: "Users & Roles", icon: Users },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
] as const;

function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-4">
        <ShieldCheck className="size-5 text-sidebar-primary" />
        <div>
          <p className="text-sm font-semibold leading-none">Bheka Console</p>
          <p className="text-xs text-muted-foreground">Eride Technologies</p>
        </div>
      </div>
      <Separator />
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = location === href || location.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover-elevate",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function TopBar() {
  const session = useSession();
  const resetCache = useResetSessionCache();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    // A failed logout still clears local state: the cookie may already be gone,
    // and leaving the user staring at a stale shell is worse than a soft sign-out.
    await logout().catch(() => undefined);
    resetCache();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="text-sm text-muted-foreground">
        {session.roles.length > 0
          ? `Roles: ${session.roles.join(", ")}`
          : "No roles assigned"}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{session.email}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
          disabled={signingOut}
        >
          <LogOut className="size-4" />
          {signingOut ? "Signing out…" : "Log out"}
        </Button>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-auto bg-background">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 py-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

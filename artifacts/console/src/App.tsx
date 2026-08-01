import { Redirect, Route, Switch } from "wouter";
import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingRows } from "@/components/states";
import { ApiError } from "@/api/client";
import { SessionProvider, useSessionQuery } from "@/lib/session";
import { LoginPage } from "@/pages/login";
import { CasesPage } from "@/pages/cases";
import { CaseDetailPage } from "@/pages/case-detail";
import { NewCasePage } from "@/pages/case-new";
import { DetectionsPage } from "@/pages/detections";
import { SitesPage } from "@/pages/sites";
import { UsersPage } from "@/pages/users";
import { ApprovalsPage } from "@/pages/approvals";

function Routes() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/cases" />} />
      <Route path="/cases" component={CasesPage} />
      <Route path="/cases/new" component={NewCasePage} />
      <Route path="/cases/:caseId" component={CaseDetailPage} />
      <Route path="/detections" component={DetectionsPage} />
      <Route path="/sites" component={SitesPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/approvals" component={ApprovalsPage} />
      <Route>
        <ErrorState
          error={
            new ApiError({
              type: "about:blank",
              title: "Page not found",
              status: 404,
              detail: "No console view is registered for this URL.",
            })
          }
        />
      </Route>
    </Switch>
  );
}

export default function App() {
  const { data: session, isPending, error } = useSessionQuery();

  if (isPending) return <LoadingRows />;

  // 401 is the signed-out state. Any other failure is a real problem worth
  // showing, since sending the user to a login form would not fix it.
  if (error) {
    if (error instanceof ApiError && error.status === 401) return <LoginPage />;
    return <ErrorState error={error} />;
  }

  if (!session) return <LoginPage />;

  return (
    <SessionProvider session={session}>
      <AppShell>
        <Routes />
      </AppShell>
    </SessionProvider>
  );
}

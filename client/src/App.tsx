import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/Landing";
import DreamMachine from "@/pages/DreamMachine";
import AuroraMonitor from "@/pages/AuroraMonitor";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const didRedirect = useRef(false);

  useEffect(() => {
    if (isAuthenticated && !didRedirect.current) {
      const dest = sessionStorage.getItem('pendingRedirect');
      if (dest) {
        didRedirect.current = true;
        sessionStorage.removeItem('pendingRedirect');
        setLocation(dest);
      }
    }
    if (!isAuthenticated) {
      didRedirect.current = false;
    }
  }, [isAuthenticated, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={Landing} />
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={DreamMachine} />
      <Route path="/dreams" component={DreamMachine} />
      <Route path="/aurora" component={AuroraMonitor} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";
import AppShell from "@/components/layout/AppShell";
import PageNotFound from "./lib/PageNotFound";
import ScrollToTop from "./components/ScrollToTop";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import NewProject from "@/pages/NewProject";
import ProjectDetail from "@/pages/ProjectDetail";
import DeploymentDetail from "@/pages/DeploymentDetail";
import Databases from "@/pages/Databases";
import NewDatabase from "@/pages/NewDatabase";
import DatabaseDetail from "@/pages/DatabaseDetail";

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/new" element={<NewProject />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
            <Route path="/projects/:projectId/deployments/:deploymentId" element={<DeploymentDetail />} />
            <Route path="/databases" element={<Databases />} />
            <Route path="/databases/new" element={<NewDatabase />} />
            <Route path="/databases/:databaseId" element={<DatabaseDetail />} />
            <Route path="*" element={<PageNotFound />} />
          </Route>
        </Routes>
      </Router>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App

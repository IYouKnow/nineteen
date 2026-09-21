import { Toaster } from "@/components/ui/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/layout/AppShell";
import PageNotFound from "./lib/PageNotFound";
import ScrollToTop from "./components/ScrollToTop";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import NewProject from "@/pages/NewProject";
import ProjectDetail from "@/pages/ProjectDetail";
import DeploymentDetail from "@/pages/DeploymentDetail";
import Databases from "@/pages/Databases";
import NewDatabase from "@/pages/NewDatabase";
import DatabaseDetail from "@/pages/DatabaseDetail";
import Storage from "@/pages/Storage";
import NewBucket from "@/pages/NewBucket";
import NewVolume from "@/pages/NewVolume";
import BucketDetail from "@/pages/BucketDetail";
import VolumeDetail from "@/pages/VolumeDetail";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminInvites from "@/pages/admin/AdminInvites";
import AdminResources from "@/pages/admin/AdminResources";
import AdminSystem from "@/pages/admin/AdminSystem";
import AdminAudit from "@/pages/admin/AdminAudit";
import { Navigate } from "react-router-dom";

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">Loading…</div>
    </div>
  );
}

function AdminRoute({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

function WriteRoute({ children }) {
  const { canWrite } = useAuth();
  if (!canWrite) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/new" element={<WriteRoute><NewProject /></WriteRoute>} />
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/projects/:projectId/deployments/:deploymentId" element={<DeploymentDetail />} />
        <Route path="/databases" element={<Databases />} />
        <Route path="/databases/new" element={<WriteRoute><NewDatabase /></WriteRoute>} />
        <Route path="/databases/:databaseId" element={<DatabaseDetail />} />
        <Route path="/storage" element={<Storage />} />
        <Route path="/storage/buckets/new" element={<WriteRoute><NewBucket /></WriteRoute>} />
        <Route path="/storage/volumes/new" element={<WriteRoute><NewVolume /></WriteRoute>} />
        <Route path="/storage/buckets/:bucketId" element={<BucketDetail />} />
        <Route path="/storage/volumes/:volumeId" element={<VolumeDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings/*" element={<Settings />} />
        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<Navigate to="/admin/users" replace />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="invites" element={<AdminInvites />} />
          <Route path="resources" element={<AdminResources />} />
          <Route path="system" element={<AdminSystem />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTop />
            <AppRoutes />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const NewProjectPage = lazy(() => import("./pages/NewProjectPage"));
const ProjectLayout = lazy(() => import("./layouts/ProjectLayout"));
const OutlinePage = lazy(() => import("./pages/OutlinePage"));
const ScenesPage = lazy(() => import("./pages/ScenesPage"));
const ChaptersPage = lazy(() => import("./pages/ChaptersPage"));
const WorkflowsPage = lazy(() => import("./pages/WorkflowsPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const ProvidersPage = lazy(() => import("./pages/ProvidersPage"));
const ExecutionsPage = lazy(() => import("./pages/ExecutionsPage"));
const AgentEditPage = lazy(() => import("./pages/AgentEditPage"));
const ExecutionDetailPage = lazy(() => import("./pages/ExecutionDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const SettingsLibraryPage = lazy(() => import("./pages/SettingsLibraryPage"));
const RagSyncPage = lazy(() => import("./pages/RagSyncPage"));

export default function App() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading...</div>}>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<NewProjectPage />} />
        <Route path="/projects/:id" element={<ProjectLayout />}>
          <Route index element={<Navigate replace to="outline" />} />
          <Route path="outline" element={<OutlinePage />} />
          <Route path="scenes" element={<ScenesPage />} />
          <Route path="chapters" element={<ChaptersPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="agents/:agentId" element={<AgentEditPage />} />
          <Route path="executions" element={<ExecutionsPage />} />
          <Route path="executions/:execId" element={<ExecutionDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings-library" element={<SettingsLibraryPage />} />
          <Route path="settings/rag-sync" element={<RagSyncPage />} />
        </Route>
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </Suspense>
  );
}

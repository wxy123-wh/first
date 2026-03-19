import { Routes, Route } from "react-router-dom";
import ProjectsPage from "./pages/ProjectsPage";
import NewProjectPage from "./pages/NewProjectPage";
import ProjectPage from "./pages/ProjectPage";
import WorkspacePage from "./pages/WorkspacePage";
import ExecutionDetailPage from "./pages/ExecutionDetailPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/projects/new" element={<NewProjectPage />} />
      <Route path="/projects/:id" element={<ProjectPage />} />
      <Route path="/projects/:id/workspace" element={<WorkspacePage />} />
      <Route path="/projects/:id/executions/:execId" element={<ExecutionDetailPage />} />
    </Routes>
  );
}

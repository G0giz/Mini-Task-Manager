import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProjectPage from "./Pages/ProjectPage";
import AddTaskForm from "./Pages/AddTaskForm";

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Navigate to="/project/1" replace />} />
                <Route path="/project/1" element={<ProjectPage />} />
                <Route path="/project/1/new" element={<AddTaskForm />} />
            </Routes>
        </BrowserRouter>
    );
}

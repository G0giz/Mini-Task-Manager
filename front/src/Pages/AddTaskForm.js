import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addTask, fetchTasks } from "../api"; // if you want to check existing IDs
import "./AddTaskFrom.css";

const STATUS_VALUES = ["todo", "in_progress", "blocked", "done"];
const PRIORITY_VALUES = ["low", "medium", "high"];

const toDate = (d) => (d ? new Date(d) : null);
const normalizeDeps = (raw) => {
    if (Array.isArray(raw)) return raw.filter((n) => Number.isInteger(n));
    if (typeof raw === "string")
        return raw
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n));
    return [];
};

export default function AddTaskForm() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [serverErr, setServerErr] = useState("");
    const [form, setForm] = useState({
        title: "",
        assignee_id: "",
        status: "todo",
        priority: "medium",
        startDate: "",
        dueDate: "",
        dependencies: "",
        estimateHours: "",
        notes: "",
    });

    const onChange = (e) => {
        const { name, value } = e.target;
        setForm((f) => ({ ...f, [name]: value }));
    };

    // Client-side validations (same rules as grid)
    const validate = async () => {
        const title = (form.title ?? "").trim();
        if (title.length < 3 || title.length > 120) {
            return `Title must be 3–120 characters`;
        }

        const deps = normalizeDeps(form.dependencies);
        let tasks = [];
        try {
            tasks = await fetchTasks(); // to verify dep existence & get their due dates/status
        } catch { }
        const byId = new Map(tasks.map((t) => [t.id, t]));
        // Dependencies must exist
        if (!deps.every((id) => byId.has(id))) {
            return `Some dependencies do not exist`;
        }

        // startDate ≤ dueDate
        const s = toDate(form.startDate);
        const d = toDate(form.dueDate);
        if (s && d && s.getTime() > d.getTime()) {
            return `startDate must be ≤ dueDate`;
        }

        // startDate ≥ max(dep.dueDate)
        const depDueDates = deps
            .map((id) => toDate(byId.get(id)?.dueDate))
            .filter(Boolean);
        if (depDueDates.length && s) {
            const maxMs = Math.max(...depDueDates.map((dt) => dt.getTime()));
            if (s.getTime() < maxMs) {
                return `startDate cannot be before max(dependency.dueDate)`;
            }
        }

        // status gating
        if (["in_progress", "done"].includes(form.status)) {
            const ok = deps.every((id) => byId.get(id)?.status === "done");
            if (!ok) return `Cannot set in_progress/done unless all dependencies are done`;
        }

        // estimateHours ≥ 0
        if (form.estimateHours !== "" && Number(form.estimateHours) < 0) {
            return `estimateHours must be ≥ 0`;
        }

        // (Optional) cycle check with new task: create a temp graph and ensure no cycle.
        // For a new task (unknown id yet), you can skip or ask server to enforce.

        return "";
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setServerErr("");
        setLoading(true);
        try {
            const err = await validate();
            if (err) {
                setServerErr(err);
                setLoading(false);
                return;
            }

            // Build payload
            const payload = {
                title: form.title.trim(),
                assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
                status: form.status,
                priority: form.priority,
                startDate: form.startDate || null,
                dueDate: form.dueDate || null,
                dependencies: normalizeDeps(form.dependencies),
                estimateHours:
                    form.estimateHours === "" ? 0 : Number(form.estimateHours) || 0,
                notes: form.notes ?? "",
            };

            await addTask(payload);
            navigate("/project/1"); // back to grid
        } catch (err) {
            setServerErr(err?.response?.data?.error || "Failed to add task");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="project-container">
            <h1>Create Task</h1>

            {serverErr && <p className="status-message error">{serverErr}</p>}

            <form className="task-form" onSubmit={onSubmit}>
                <div className="form-row">
                    <label htmlFor="title">Title *</label>
                    <input
                        id="title"
                        name="title"
                        value={form.title}
                        onChange={onChange}
                        required
                        minLength={3}
                        maxLength={120}
                        placeholder="Short, descriptive title"
                    />
                </div>

                <div className="form-row">
                    <label htmlFor="assignee_id">Assignee ID</label>
                    <input
                        id="assignee_id"
                        name="assignee_id"
                        value={form.assignee_id}
                        onChange={onChange}
                        inputMode="numeric"
                        placeholder="e.g. 12"
                    />
                </div>

                <div className="form-row">
                    <label htmlFor="status">Status</label>
                    <select id="status" name="status" value={form.status} onChange={onChange}>
                        {STATUS_VALUES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>

                <div className="form-row">
                    <label htmlFor="priority">Priority</label>
                    <select id="priority" name="priority" value={form.priority} onChange={onChange}>
                        {PRIORITY_VALUES.map((p) => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                </div>

                <div className="form-row two">
                    <div>
                        <label htmlFor="startDate">Start Date</label>
                        <input
                            id="startDate"
                            name="startDate"
                            type="date"
                            value={form.startDate}
                            onChange={onChange}
                        />
                    </div>
                    <div>
                        <label htmlFor="dueDate">Due Date</label>
                        <input
                            id="dueDate"
                            name="dueDate"
                            type="date"
                            value={form.dueDate}
                            onChange={onChange}
                        />
                    </div>
                </div>

                <div className="form-row">
                    <label htmlFor="dependencies">Dependencies (IDs, comma-separated)</label>
                    <input
                        id="dependencies"
                        name="dependencies"
                        value={form.dependencies}
                        onChange={onChange}
                        placeholder="e.g. 1, 3, 12"
                    />
                </div>

                <div className="form-row">
                    <label htmlFor="estimateHours">Estimate Hours</label>
                    <input
                        id="estimateHours"
                        name="estimateHours"
                        value={form.estimateHours}
                        onChange={onChange}
                        inputMode="numeric"
                        placeholder="0"
                    />
                </div>

                <div className="form-row">
                    <label htmlFor="notes">Notes</label>
                    <textarea
                        id="notes"
                        name="notes"
                        value={form.notes}
                        onChange={onChange}
                        rows={3}
                        placeholder="Optional notes"
                    />
                </div>

                <div className="button-group">
                    <button type="button" onClick={() => navigate("/project/1")}>
                        Cancel
                    </button>
                    <button type="submit" disabled={loading}>
                        {loading ? "Saving..." : "Create Task"}
                    </button>
                </div>
            </form>
        </div>
    );
}

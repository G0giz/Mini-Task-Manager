import React, { useMemo, useRef, useState, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import { SetFilterModule } from "ag-grid-enterprise";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import { fetchTasks, addTask, updateTask, deleteTask } from "../api";
import { useNavigate } from "react-router-dom";
import "./ProjectPage.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

ModuleRegistry.registerModules([AllCommunityModule, SetFilterModule]);

// ---------- utils ----------
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
const isBlocked = (task, get) =>
    (task?.dependencies || []).some((d) => get(d)?.status !== "done");

// ---------- renderers / editors ----------
const DependenciesCell = (p) => {
    const ids = Array.isArray(p.value) ? p.value : [];
    const byId = p.context?.byId || new Map();
    if (!ids.length) return <span>-</span>;

    return (
        <div className="deps-chips" role="list">
            {ids.map((id) => {
                const dep = byId.get(id);
                const title = dep?.title ?? `Task ${id}`;
                const status = dep?.status ?? "unknown";
                const due = dep?.dueDate ?? "N/A";
                return (
                    <span
                        key={id}
                        role="listitem"
                        className="chip-dep"
                        title={`#${id} · ${title}\nstatus: ${status}\ndue: ${due}`}
                        aria-label={`Dependency ${id}: ${title}, status ${status}, due ${due}`}
                    >
                        #{id}: {title}
                    </span>
                );
            })}
        </div>
    );
};

const DependenciesEditor = (p) => {
    const { value, node, column, api } = p;
    const [input, setInput] = React.useState(
        Array.isArray(value) ? value.join(",") : ""
    );

    const commit = () => {
        // allow only digits/commas/spaces
        const cleaned = input.replace(/[^0-9, ]/g, "");
        const arr = normalizeDeps(cleaned);
        node.setDataValue(column.getColId(), arr);
        api.stopEditing(false);
    };

    return (
        <input
            className="dependencies-input"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9, ]/g, ""))}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") api.stopEditing(true);
            }}
            autoFocus
            aria-label={`Edit dependencies for task ${node.data.id}`}
            placeholder="e.g. 1, 3, 12"
        />
    );
};

const StatusCell = (p) => {
    const get = p.context?.getTask || (() => undefined);
    const blocked = isBlocked(p.data, get);
    return (
        <span className="status-cell">
            {p.value}
            {blocked && (
                <span className="blocked-indicator" title="Blocked by dependencies">
                    {" "}
                    🔒
                </span>
            )}
        </span>
    );
};

const ProjectPage = () => {
    const [tasks, setTasks] = useState([]);
    const [selectedRows, setSelectedRows] = useState([]);
    const [editedTasks, setEditedTasks] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [rtl, setRtl] = useState(() => {
        try { return JSON.parse(localStorage.getItem("rtl") || "false"); }
        catch { return false; }
    });
    const gridRef = useRef();
    const navigate = useNavigate();

    // ------------ data load ------------
    const loadTasks = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchTasks();
            const parsed = data.map((t) => ({
                ...t,
                dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
            }));
            setTasks(parsed);
        } catch (err) {
            console.error(err);
            setError("Failed to load tasks.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTasks();
    }, []);

    useEffect(() => {
        try { localStorage.setItem("rtl", JSON.stringify(rtl)); } catch { }
    }, [rtl]);

    useEffect(() => {
        gridRef.current?.api?.ensureColumnVisible("id");
        gridRef.current?.api?.refreshHeader();
    }, [rtl, tasks]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.ctrlKey && e.altKey && (e.key === "r" || e.key === "R")) {
                setRtl((v) => !v);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    // ------------ helpers ------------
    const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
    const getTask = (id) => byId.get(id);
    const gridContext = useMemo(
        () => ({
            byId,
            getTask,
            markEdited: (row) =>
                setEditedTasks((prev) => ({ ...prev, [row.id]: { ...row } })),
        }),
        [byId]
    );

    // ------------ actions ------------
    const handleAddTask = () => {
        navigate("/project/1/new");
    };

    const handleDeleteTasks = async () => {
        if (!selectedRows.length) return;

        const dependentTasks = tasks.filter((t) =>
            selectedRows.some((sel) => t.dependencies?.includes(sel.id))
        );

        let confirmMessage = "Are you sure you want to delete the selected task(s)?";
        if (dependentTasks.length) {
            confirmMessage = `Other tasks depend on the selected task(s): ${dependentTasks
                .map((t) => t.title)
                .join(", ")}. Delete anyway?`;
        }

        if (!window.confirm(confirmMessage)) return;

        try {
            for (const row of selectedRows) {
                await deleteTask(row.id);
            }
            await loadTasks();
        } catch (err) {
            alert(err?.response?.data?.error || "Failed to delete task");
            console.error(err);
        }
    };

    const handleSaveChanges = async () => {
        const edited = Object.values(editedTasks);
        if (!edited.length) return;

        // 1) merge edits over current tasks
        const mergedById = new Map(tasks.map((t) => [t.id, { ...t }]));
        for (const t of edited) {
            mergedById.set(t.id, { ...mergedById.get(t.id), ...t });
            mergedById.get(t.id).dependencies = normalizeDeps(
                mergedById.get(t.id).dependencies
            );
        }
        const merged = Array.from(mergedById.values());
        const allIds = new Set(merged.map((t) => t.id));
        const get = (id) => mergedById.get(id);

        // 2) validations
        for (const task of edited) {
            const title = (task.title ?? "").trim();
            if (title.length < 3 || title.length > 120) {
                alert(
                    `Task "${task.title || "(no title)"}": title must be 3–120 characters`
                );
                return;
            }
        }

        for (const task of edited) {
            if (!task.dependencies.every((d) => allIds.has(d))) {
                alert(`Task "${task.title}": Some dependencies do not exist`);
                return;
            }
        }

        for (const task of edited) {
            const s = toDate(task.startDate);
            const d = toDate(task.dueDate);
            if (s && d && s.getTime() > d.getTime()) {
                alert(`Task "${task.title}": startDate must be ≤ dueDate`);
                return;
            }
        }

        for (const task of edited) {
            const depDueDates = task.dependencies
                .map((depId) => toDate(get(depId)?.dueDate))
                .filter(Boolean);
            if (depDueDates.length) {
                const maxMs = Math.max(...depDueDates.map((dt) => dt.getTime()));
                const s = toDate(task.startDate);
                if (s && s.getTime() < maxMs) {
                    alert(
                        `Task "${task.title}": startDate cannot be before max(dependency.dueDate)`
                    );
                    return;
                }
            }
        }

        for (const task of edited) {
            if (["in_progress", "done"].includes(task.status)) {
                const allDepsDone = task.dependencies.every(
                    (depId) => get(depId)?.status === "done"
                );
                if (!allDepsDone) {
                    alert(
                        `Task "${task.title}": Cannot set in_progress/done unless all dependencies are done`
                    );
                    return;
                }
            }
        }

        // cycles on whole merged graph
        const visited = new Set();
        const stack = new Set();
        const dfs = (id) => {
            if (stack.has(id)) return true;
            if (visited.has(id)) return false;
            visited.add(id);
            stack.add(id);
            const t = get(id);
            for (const dep of t?.dependencies || []) {
                if (dfs(dep)) return true;
            }
            stack.delete(id);
            return false;
        };
        for (const t of merged) {
            if (dfs(t.id)) {
                alert(`Dependencies create a cycle (e.g., involving task "${t.title}")`);
                return;
            }
        }

        // 3) persist
        try {
            for (const task of edited) {
                if (task.estimateHours != null && Number(task.estimateHours) < 0) {
                    alert(`Task "${task.title}": estimateHours must be ≥ 0`);
                    return;
                }
                await updateTask(task);
            }
            setEditedTasks({});
            await loadTasks();
        } catch (err) {
            alert(err?.response?.data?.error || "Failed to save changes");
            console.error(err);
        }
    };

    // ------------ columns ------------
    const columns = useMemo(
        () => [
            {
                headerName: "ID",
                field: "id",
                width: 100,
                headerClass: "header-center",
                editable: false,
                suppressClickEdit: true,
                suppressNavigable: true,
                cellClass: "id-cell",
            },
            {
                headerName: "Title",
                field: "title",
                editable: true,
                filter: "agTextColumnFilter",
                headerClass: "header-center",
                flex: 3,
                minWidth: 250,
                wrapText: true,
                autoHeight: true,
            },
            {
                headerName: "Assignee",
                field: "assignee_id",
                editable: true,
                filter: "agNumberColumnFilter",
                headerClass: "header-center",
            },
            {
                headerName: "Status",
                field: "status",
                editable: true,
                filter: "agSetColumnFilter",
                cellRenderer: StatusCell,
                headerClass: "header-center",
                cellEditor: "agSelectCellEditor",
                cellEditorParams: {
                    values: ["todo", "in_progress", "blocked", "done"],
                },
            },
            {
                headerName: "Priority",
                field: "priority",
                editable: true,
                filter: "agSetColumnFilter",
                headerClass: "header-center",
                cellEditor: "agSelectCellEditor",
                cellEditorParams: {
                    values: ["low", "medium", "high"],
                },
            },
            {
                headerName: "Start Date",
                field: "startDate",
                editable: true,
                filter: "agDateColumnFilter",
                headerClass: "header-center",
                flex: 1,
                minWidth: 120,
                wrapText: true,
                autoHeight: true,
            },
            {
                headerName: "Due Date",
                field: "dueDate",
                editable: true,
                filter: "agDateColumnFilter",
                headerClass: "header-center",
                flex: 1,
                minWidth: 120,
                wrapText: true,
                autoHeight: true,
            },
            {
                headerName: "Dependencies",
                field: "dependencies",
                editable: true,
                cellRenderer: DependenciesCell,
                cellEditor: DependenciesEditor,
                headerClass: "header-center",
                flex: 3,
                minWidth: 250,
                wrapText: true,
                autoHeight: true,
                cellClass: "deps-cell",
                valueSetter: (params) => {
                    const arr = normalizeDeps(params.newValue);
                    params.data.dependencies = arr;
                    params.context?.markEdited?.(params.data);
                    return true;
                },
            },
            {
                headerName: "Estimate Hours",
                field: "estimateHours",
                editable: true,
                filter: "agNumberColumnFilter",
                headerClass: "header-center",
                valueSetter: (p) => {
                    const n = Number(p.newValue);
                    p.data.estimateHours = Number.isFinite(n) ? n : 0;
                    p.context?.markEdited?.(p.data);
                    return true;
                },
            },
            {
                headerName: "Notes",
                field: "notes",
                editable: true,
                filter: "agTextColumnFilter",
                headerClass: "header-center",
                flex: 3,
                minWidth: 250,
                wrapText: true,
                autoHeight: true,
            },
        ],
        []
    );

    // row style: blocked rows highlighted
    const rowClassRules = useMemo(
        () => ({
            "blocked-row": (p) => isBlocked(p.data, getTask),
        }),
        [tasks]
    );

    return (
        // set dir attribute for the whole page (mirrors AG Grid's 'ag-rtl' class)
        <div className="project-container" dir={rtl ? "rtl" : "ltr"}>
            <h1>Project 1 Tasks</h1>

            {loading && <p className="status-message loading">Loading tasks...</p>}
            {error && <p className="status-message error">{error}</p>}
            {!loading && !error && tasks.length === 0 && (
                <p className="status-message empty">No tasks available.</p>
            )}

            <div className="button-group">
                <button onClick={handleAddTask}>Add Task</button>
                <button onClick={handleDeleteTasks} disabled={!selectedRows.length}>
                    Delete Selected
                </button>
                <button
                    onClick={handleSaveChanges}
                    disabled={Object.keys(editedTasks).length === 0}
                >
                    Save Changes
                </button>
                <button type="button" onClick={() => setRtl((v) => !v)}>
                    Toggle {rtl ? "LTR" : "RTL"}
                </button>
            </div>

            {!loading && !error && tasks.length > 0 && (
                // AG Grid RTL: add 'ag-rtl' class when rtl is true
                <div
                    className={`ag-theme-alpine grid-container ${rtl ? "ag-rtl" : ""}`}
                >
                    <AgGridReact
                        ref={gridRef}
                        rowData={tasks}
                        columnDefs={columns}
                        context={gridContext}
                        enableRtl={rtl}
                        defaultColDef={{
                            sortable: true,
                            filter: true,
                            resizable: true,
                            flex: 1,
                            editable: true, // optional default
                            minWidth: 200,
                        }}
                        rowSelection="multiple"
                        onCellValueChanged={(e) => {
                            const row = {
                                ...e.data,
                                dependencies: normalizeDeps(e.data.dependencies),
                            };
                            setEditedTasks((prev) => ({ ...prev, [row.id]: row }));
                        }}
                        singleClickEdit={true}
                        stopEditingWhenCellsLoseFocus={true}
                        onSelectionChanged={(e) => setSelectedRows(e.api.getSelectedRows())}
                        getRowId={(p) => String(p.data.id)}
                        tabToNextCell={(params) => params.nextCellPosition}
                        rowClassRules={rowClassRules}
                        onFirstDataRendered={(e) => e.api.ensureColumnVisible("id")}
                    />
                </div>
            )}
        </div>
    );
};

export default ProjectPage;

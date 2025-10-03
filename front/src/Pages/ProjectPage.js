// src/pages/ProjectPage.jsx
import React, { useRef, useState, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import { SetFilterModule } from "ag-grid-enterprise";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import { fetchTasks, addTask, updateTask, deleteTask } from "../api";
import { useNavigate } from "react-router-dom";
import "./ProjectPage.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

// AG Grid modules (basic)
ModuleRegistry.registerModules([AllCommunityModule, SetFilterModule]);

// ----- Small helpers (kept very simple) -----
function toDate(value) {
    return value ? new Date(value) : null;
}

// Turn "1, 3, 10" or [1,3,10] into [1,3,10] safely
function normalizeDependencies(input) {
    if (Array.isArray(input)) {
        return input.filter((n) => Number.isInteger(n));
    }
    if (typeof input === "string") {
        return input
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n));
    }
    return [];
}

// Check if a task is blocked: any dependency not "done"
function checkBlocked(task, getTaskById) {
    const deps = task?.dependencies || [];
    for (let i = 0; i < deps.length; i++) {
        const depTask = getTaskById(deps[i]);
        if (!depTask || depTask.status !== "done") return true;
    }
    return false;
}

// ----- Cell renderers / editors kept straightforward -----
function DependenciesCellRenderer(params) {
    const ids = Array.isArray(params.value) ? params.value : [];
    const getTaskById = params.context?.getTaskById || (() => undefined);

    if (!ids.length) return <span>-</span>;

    return (
        <div className="deps-chips" role="list">
            {ids.map((id) => {
                const dep = getTaskById(id);
                const title = dep?.title || `Task ${id}`;
                const status = dep?.status || "unknown";
                const due = dep?.dueDate || "N/A";
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
}

function DependenciesEditor(params) {
    const { value, node, column, api } = params;
    const [text, setText] = React.useState(
        Array.isArray(value) ? value.join(",") : ""
    );

    function commit() {
        // simple guard: only numbers, commas, spaces
        const cleaned = text.replace(/[^0-9, ]/g, "");
        const arr = normalizeDependencies(cleaned);
        node.setDataValue(column.getColId(), arr);
        api.stopEditing(false);
    }

    return (
        <input
            className="dependencies-input"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^0-9, ]/g, ""))}
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
}

function StatusCellRenderer(params) {
    const getTaskById = params.context?.getTaskById || (() => undefined);
    const blocked = checkBlocked(params.data, getTaskById);

    return (
        <span className="status-cell">
            {params.value}
            {blocked && (
                <span className="blocked-indicator" title="Blocked by dependencies">
                    {" "}
                    🔒
                </span>
            )}
        </span>
    );
}

// ----- The page (simple junior style) -----
export default function ProjectPage() {
    // Basic state, very explicit names
    const [taskList, setTaskList] = useState([]);
    const [selectedRows, setSelectedRows] = useState([]);
    const [editedMap, setEditedMap] = useState({}); // { [id]: taskDraft }
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null);
    const [isRtl, setIsRtl] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem("rtl") || "false");
        } catch {
            return false;
        }
    });

    const gridRef = useRef();
    const navigate = useNavigate();


    // Load tasks once on mount
    async function loadData() {
        setIsLoading(true);
        setErrorMsg(null);
        try {
            const data = await fetchTasks();
            // make sure dependencies is always an array
            const cleaned = data.map((t) => ({
                ...t,
                dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
            }));
            setTaskList(cleaned);
        } catch (err) {
            console.error(err);
            setErrorMsg("Failed to load tasks.");
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        document.body.dir = isRtl ? "rtl" : "ltr";
    }, [isRtl]);


    useEffect(() => {
        localStorage.setItem("rtl", JSON.stringify(isRtl));
    }, [isRtl]);


    useEffect(() => {
        const toggleDir = (e) => {
            if (e.ctrlKey && e.altKey && (e.key === "r" || e.key === "R")) {
                setIsRtl((v) => !v);
            }
        };
        window.addEventListener("keydown", toggleDir);
        return () => window.removeEventListener("keydown", toggleDir);
    }, []);


    // map helpers written directly (simple)
    function getTaskById(id) {
        return taskList.find((t) => t.id === id);
    }

    // ----- Actions -----
    function onAddTask() {
        // navigate to a simple form page for add
        navigate("/project/1/new");
    }

    async function onDeleteSelected() {
        if (!selectedRows.length) return;

        // Find tasks that depend on selected rows
        const selectedIds = new Set(selectedRows.map((r) => r.id));
        const dependents = taskList.filter((t) =>
            t.dependencies?.some((depId) => selectedIds.has(depId))
        );

        let confirmText = "Are you sure you want to delete the selected task(s)?";
        if (dependents.length) {
            confirmText =
                "Other tasks depend on the selected task(s): " +
                dependents.map((t) => t.title).join(", ") +
                ". Delete anyway?";
        }

        if (!window.confirm(confirmText)) return;

        try {
            for (let i = 0; i < selectedRows.length; i++) {
                await deleteTask(selectedRows[i].id);
            }
            await loadData();
        } catch (err) {
            alert(err?.response?.data?.error || "Failed to delete task(s)");
            console.error(err);
        }
    }

    async function onSaveChanges() {
        // Get the edited tasks
        const editedTasks = Object.values(editedMap);
        if (editedTasks.length === 0) return;

        // Copy all tasks into a map by ID
        const taskMap = new Map(taskList.map(task => [task.id, { ...task }]));

        // Update the map with the edited tasks
        for (const task of editedTasks) {
            const existing = taskMap.get(task.id) || {};
            const updated = { ...existing, ...task };
            updated.dependencies = normalizeDependencies(updated.dependencies);
            taskMap.set(task.id, updated);
        }

        const allTasks = Array.from(taskMap.values());

        // --- VALIDATIONS ---

        // A) Check title length
        for (const task of editedTasks) {
            console.log(task.title);

            const title = (task.title || "").trim();
            if (title.length < 3 || title.length > 120) {
                alert(`Task ${title || "(no title)"}: title must be 3–120 characters`);
                return;
            }
        }

        // B) Check that dependencies exist
        for (const task of editedTasks) {
            for (const depId of (task.dependencies || [])) {
                if (!taskMap.has(depId)) {
                    alert(`Task ${task.title}: dependency ${depId} does not exist`);
                    return;
                }
            }
        }

        // C) Check that startDate is not after dueDate
        for (const task of editedTasks) {
            const start = toDate(task.startDate);
            const due = toDate(task.dueDate);
            if (start && due && start > due) {
                alert(`Task ${task.title}: start date must be before or equal to due date`);
                return;
            }
        }

        // D) Check that startDate is after dependency due dates
        for (const task of editedTasks) {
            const depDates = (task.dependencies || [])
                .map(id => toDate(taskMap.get(id)?.dueDate))
                .filter(Boolean);
            if (depDates.length > 0) {
                const latest = new Date(Math.max(...depDates.map(d => d.getTime())));
                const start = toDate(task.startDate);
                if (start && start < latest) {
                    alert(`Task ${task.title}: start date must be after all dependencies`);
                    return;
                }
            }
        }

        // E) Check status logic
        for (const task of editedTasks) {
            if (task.status === "in_progress" || task.status === "done") {
                const deps = task.dependencies || [];
                const allDone = deps.every(id => taskMap.get(id)?.status === "done");
                if (!allDone) {
                    alert(`Task ${task.title}: can't be '${task.status}' unless all dependencies are done`);
                    return;
                }
            }
        }

        // F) Check for cycles
        for (const task of allTasks) {
            const seen = new Set();
            const stack = [...(task.dependencies || [])];
            while (stack.length) {
                const depId = stack.pop();
                if (depId === task.id) {
                    alert(`Task ${task.title}: cycle detected`);
                    return;
                }
                if (!seen.has(depId)) {
                    seen.add(depId);
                    const dep = taskMap.get(depId);
                    if (dep) stack.push(...(dep.dependencies || []));
                }
            }
        }

        // G) Check estimateHours
        for (const task of editedTasks) {
            if (task.estimateHours != null && Number(task.estimateHours) < 0) {
                alert(`Task ${task.title}: estimateHours must be >= 0`);
                return;
            }
        }

        // H) Optional: validate status value
        for (const task of editedTasks) {
            const validStatus = ["todo", "in_progress", "done"];
            if (!validStatus.includes(task.status)) {
                alert(`Task ${task.title}: status must be one of ${validStatus.join(", ")}`);
                return;
            }
        }

        // --- SAVE CHANGES ---
        try {
            for (const task of editedTasks) {
                await updateTask(task);
            }
            setEditedMap({});
            await loadData();
        } catch (err) {
            alert(err?.response?.data?.error || "Failed to save changes");
            console.error(err);
        }
    }


    // ----- Columns (kept inline and obvious) -----
    const columnDefs = [
        {
            headerName: "ID",
            field: "id",
            width: 100,
            headerClass: "header-center",
            editable: false,
            suppressClickEdit: true,
            suppressNavigable: true,
            cellClass: "id-cell",
            pinned: isRtl ? "right" : "left",   // 👈 add this line
            suppressSizeToFit: true,
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
            cellRenderer: StatusCellRenderer,
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
            cellRenderer: DependenciesCellRenderer,
            cellEditor: DependenciesEditor,
            headerClass: "header-center",
            flex: 3,
            minWidth: 250,
            wrapText: true,
            autoHeight: true,
            cellClass: "deps-cell",
            valueSetter: (params) => {
                const arr = normalizeDependencies(params.newValue);
                params.data.dependencies = arr;
                // mark row as edited
                const nextRow = { ...params.data };
                setEditedMap((prev) => ({ ...prev, [nextRow.id]: nextRow }));
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
                // mark row as edited
                const nextRow = { ...p.data };
                setEditedMap((prev) => ({ ...prev, [nextRow.id]: nextRow }));
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
    ];

    // ----- Row styling: highlight blocked tasks -----
    const rowClassRules = {
        "blocked-row": (p) => checkBlocked(p.data, getTaskById),
    };

    // ----- Render -----
    return (
        <div className="project-container">
            <h1>Project 1 Tasks</h1>

            {isLoading && <p className="status-message loading">Loading tasks...</p>}
            {errorMsg && <p className="status-message error">{errorMsg}</p>}
            {!isLoading && !errorMsg && taskList.length === 0 && (
                <p className="status-message empty">No tasks available.</p>
            )}

            <div className="button-group">
                <button onClick={onAddTask}>Add Task</button>
                <button onClick={onDeleteSelected} disabled={!selectedRows.length}>
                    Delete Selected
                </button>
                <button onClick={onSaveChanges} disabled={!Object.keys(editedMap).length}>
                    Save Changes
                </button>
                <button onClick={() => setIsRtl((v) => !v)}>
                    Toggle {isRtl ? "LTR" : "RTL"}
                </button>
            </div>

            {!isLoading && !errorMsg && taskList.length > 0 && (
                <div className="ag-theme-alpine grid-container">
                    <AgGridReact
                        ref={gridRef}
                        rowData={taskList}
                        columnDefs={columnDefs}
                        context={{ getTaskById }}
                        defaultColDef={{
                            sortable: true,
                            filter: true,
                            resizable: true,
                            flex: 1,
                            editable: true,
                            minWidth: 200,
                        }}
                        enableRtl={isRtl}
                        rowSelection="multiple"
                        onCellValueChanged={(e) => {
                            // Whenever a cell changes, mark this row as edited
                            const updatedRow = {
                                ...e.data,
                                dependencies: normalizeDependencies(e.data.dependencies),
                            };
                            setEditedMap((prev) => ({ ...prev, [updatedRow.id]: updatedRow }));
                        }}
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
}

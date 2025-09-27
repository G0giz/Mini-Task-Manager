const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { readDB, writeDB } = require('./db');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// --- Validation ---
function validateTaskInput(body, existingTasks = []) {
    const { id, title, startDate, dueDate, dependencies = [] } = body;
    if (!title || title.length < 3 || title.length > 120) return 'Title must be 3-120 chars';
    if (startDate && dueDate && new Date(startDate) > new Date(dueDate)) return 'Start date > due date';
    if (!Array.isArray(dependencies)) return 'Dependencies must be an array';
    if (id && dependencies.includes(id)) return 'Task cannot depend on itself';

    const existingIds = new Set(existingTasks.map(t => t.id));
    for (let depId of dependencies) {
        if (!existingIds.has(depId)) return `Dependency task ${depId} does not exist`;
    }

    return null;
}

// --- CRUD Routes ---
// Get all tasks
app.get('/tasks', (req, res) => {
    const db = readDB();
    res.json(db.tasks);
});

// Create task
app.post('/tasks', (req, res) => {
    const db = readDB();
    const error = validateTaskInput(req.body, db.tasks);
    if (error) return res.status(400).json({ error });

    const newTask = {
        ...req.body,
        id: db.tasks.length ? Math.max(...db.tasks.map(t => t.id)) + 1 : 1,
        dependencies: req.body.dependencies || []
    };

    db.tasks.push(newTask);
    writeDB(db);
    res.json(newTask);
});

// Update task
app.put('/tasks/:id', (req, res) => {
    const db = readDB();
    const taskId = Number(req.params.id);
    const updatedTask = { ...req.body, id: taskId };

    const error = validateTaskInput(updatedTask, db.tasks);
    if (error) return res.status(400).json({ error });

    // Dependencies exist
    const allTaskIds = db.tasks.map(t => t.id);
    if (!updatedTask.dependencies.every(depId => allTaskIds.includes(depId))) {
        return res.status(400).json({ error: 'Some dependencies do not exist' });
    }

    // Self-cycle check
    if (updatedTask.dependencies.includes(taskId)) {
        return res.status(400).json({ error: 'Task cannot depend on itself' });
    }

    // Detect cycles
    const visited = new Set();
    const stack = new Set();
    const visit = (id) => {
        if (stack.has(id)) return true;
        if (visited.has(id)) return false;
        visited.add(id);
        stack.add(id);
        const t = db.tasks.find(x => x.id === id);
        for (let depId of t?.dependencies || []) {
            if (visit(depId)) return true;
        }
        stack.delete(id);
        return false;
    };
    if (visit(taskId)) return res.status(400).json({ error: 'Dependencies create a cycle' });

    // Start date >= max(dependency.dueDate)
    if (updatedTask.startDate && updatedTask.dependencies.length) {
        const maxDue = Math.max(...updatedTask.dependencies.map(depId => {
            const dep = db.tasks.find(t => t.id === depId);
            return dep?.dueDate ? new Date(dep.dueDate).getTime() : 0;
        }));
        if (new Date(updatedTask.startDate).getTime() < maxDue) {
            return res.status(400).json({ error: 'startDate cannot be before max(dependency.dueDate)' });
        }
    }

    // Status validation
    if (['in_progress', 'done'].includes(updatedTask.status)) {
        const allDone = updatedTask.dependencies.every(depId => {
            const dep = db.tasks.find(t => t.id === depId);
            return dep.status === 'done';
        });
        if (!allDone) return res.status(400).json({ error: 'Cannot set in_progress/done unless all dependencies are done' });
    }

    // Update task
    const idx = db.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    db.tasks[idx] = updatedTask;
    writeDB(db);
    res.json(updatedTask);
});

// Delete task
app.delete('/tasks/:id', (req, res) => {
    const db = readDB();
    const id = Number(req.params.id);
    const isDependedOn = db.tasks.some(t => t.dependencies.includes(id));
    if (isDependedOn) return res.status(400).json({ error: 'Other tasks depend on this task' });

    db.tasks = db.tasks.filter(t => t.id !== id);
    writeDB(db);
    res.json({ deleted: true });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

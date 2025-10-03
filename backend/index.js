// server.js (same logic, clearer variable names)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { readDB, writeDB } = require('./db');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// --- Validation ---
function validateTaskInput(requestBody, existingTasks = []) {
    const {
        id: taskIdFromBody,
        title,
        startDate,
        dueDate,
        dependencies = [],
    } = requestBody;

    // basic field checks
    if (!title || title.length < 3 || title.length > 120) return 'Title must be 3-120 chars';
    if (startDate && dueDate && new Date(startDate) > new Date(dueDate)) return 'Start date > due date';
    if (!Array.isArray(dependencies)) return 'Dependencies must be an array';

    // self dependency
    if (taskIdFromBody && dependencies.includes(taskIdFromBody)) return 'Task cannot depend on itself';

    // all dependencies must exist
    const existingTaskIds = new Set(existingTasks.map(task => task.id));
    for (const dependencyId of dependencies) {
        if (!existingTaskIds.has(dependencyId)) {
            return `Dependency task ${dependencyId} does not exist`;
        }
    }

    return null; // valid
}

// --- CRUD Routes ---
// Get all tasks
app.get('/tasks', (req, res) => {
    const database = readDB();
    res.json(database.tasks);
});

// Create task
app.post('/tasks', (req, res) => {
    const database = readDB();

    const validationError = validateTaskInput(req.body, database.tasks);
    if (validationError) return res.status(400).json({ error: validationError });

    const newTask = {
        ...req.body,
        id: database.tasks.length ? Math.max(...database.tasks.map(task => task.id)) + 1 : 1,
        dependencies: req.body.dependencies || []
    };

    database.tasks.push(newTask);
    writeDB(database);
    res.json(newTask);
});


// Update task
app.put('/tasks/:id', (req, res) => {
    // Read DB (json file with tasks)
    const db = readDB();
    const taskId = Number(req.params.id);

    // Take the incoming body and make sure the ID stays the same
    const updatedTask = { ...req.body, id: taskId };

    // Check if task exists
    const idx = db.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) {
        return res.status(404).json({ error: 'Task not found' });
    }

    // Check dependencies exist
    const allTaskIds = db.tasks.map(t => t.id);
    for (const depId of updatedTask.dependencies || []) {
        if (!allTaskIds.includes(depId)) {
            return res.status(400).json({ error: 'Some dependencies do not exist' });
        }
    }

    // Check self dependency
    if ((updatedTask.dependencies || []).includes(taskId)) {
        return res.status(400).json({ error: 'Task cannot depend on itself' });
    }

    // Simple cycle check (no recursion, just loop)
    // Walk through dependencies in a queue until empty
    // If we come back to the same task → cycle
    const queue = [...(updatedTask.dependencies || [])];
    const visited = new Set();

    while (queue.length > 0) {
        const depId = queue.shift();
        if (depId === taskId) {
            return res.status(400).json({ error: 'Dependencies create a cycle' });
        }
        if (!visited.has(depId)) {
            visited.add(depId);
            const depTask = db.tasks.find(t => t.id === depId);
            if (depTask) {
                queue.push(...(depTask.dependencies || []));
            }
        }
    }

    // Check start date vs dependency due dates
    if (updatedTask.startDate && (updatedTask.dependencies || []).length > 0) {
        let maxDueTime = 0;
        for (const depId of updatedTask.dependencies) {
            const dep = db.tasks.find(t => t.id === depId);
            if (dep?.dueDate) {
                const time = new Date(dep.dueDate).getTime();
                if (time > maxDueTime) maxDueTime = time;
            }
        }
        if (new Date(updatedTask.startDate).getTime() < maxDueTime) {
            return res.status(400).json({ error: 'startDate cannot be before dependencies' });
        }
    }

    // Status check: in_progress/done only if all deps are done
    if (['in_progress', 'done'].includes(updatedTask.status)) {
        let allDepsDone = true;
        for (const depId of updatedTask.dependencies || []) {
            const dep = db.tasks.find(t => t.id === depId);
            if (dep?.status !== 'done') {
                allDepsDone = false;
                break;
            }
        }
        if (!allDepsDone) {
            return res.status(400).json({ error: 'Cannot set in_progress/done unless all dependencies are done' });
        }
    }

    // Save back to DB
    db.tasks[idx] = updatedTask;
    writeDB(db);

    res.json(updatedTask);
});

// Delete task
app.delete('/tasks/:id', (req, res) => {
    const database = readDB();
    const taskId = +req.params.id;

    let isReferencedByOthers = false;
    for (const task of database.tasks) {
        if (task.dependencies.includes(taskId)) {
            isReferencedByOthers = true;
            break;
        }
    }

    if (isReferencedByOthers) {
        return res.status(400).json({ error: 'Other tasks depend on this task' });
    }

    database.tasks = database.tasks.filter(task => task.id !== taskId);
    writeDB(database);
    res.json({ deleted: true });
});


app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});




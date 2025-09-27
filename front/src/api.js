import axios from "axios";

const BASE_URL = "http://localhost:3001";

export const fetchTasks = async () => {
    const res = await axios.get(`${BASE_URL}/tasks`);
    return res.data.map(t => ({
        ...t,
        dependencies: Array.isArray(t.dependencies)
            ? t.dependencies
            : typeof t.dependencies === "string"
                ? JSON.parse(t.dependencies || "[]")
                : [],
    }));
};

export const addTask = async (task) => {
    const newTask = {
        title: "New Task",
        assignee_id: null,
        status: "todo",
        priority: "medium",
        startDate: "",
        dueDate: "",
        dependencies: [],
        estimateHours: 0,
        notes: "",
        ...task,
    };
    return axios.post(`${BASE_URL}/tasks`, newTask);
};

export const updateTask = async (task) => {
    return axios.put(`${BASE_URL}/tasks/${task.id}`, task);
};

export const deleteTask = async (id) => {
    return axios.delete(`${BASE_URL}/tasks/${id}`);
};

// db.js
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'tasks.json');

function readDB() {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({ tasks: [], users: [] }, null, 2));
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
}

function writeDB(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = { readDB, writeDB };

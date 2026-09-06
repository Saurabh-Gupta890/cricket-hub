const fs = require('fs');
const path = require('path');

function safeReadJsonFile(filepath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filepath)) {
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filepath, JSON.stringify(defaultValue, null, 2), 'utf8');
      return defaultValue;
    }
    const content = fs.readFileSync(filepath, 'utf8');
    if (!content || !content.trim()) return defaultValue;
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${filepath}:`, err.message);
    return defaultValue;
  }
}

function safeWriteJsonFile(filepath, data) {
  try {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filepath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filepath);
  } catch (err) {
    console.error(`Error writing ${filepath}:`, err.message);
  }
}

module.exports = {
  safeReadJsonFile,
  safeWriteJsonFile
};

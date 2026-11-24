// Small persistent store on top of localStorage (silently in-memory when storage is blocked).
const KEY = 'quantum-library:v1';
const memory = { settings: {}, progress: {}, marks: [], recent: [] };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(memory, JSON.parse(raw));
  } catch {
    /* private mode / blocked storage: keep in memory */
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* ignore */
  }
}
load();

export const store = {
  get settings() {
    return memory.settings;
  },
  setSetting(k, v) {
    memory.settings[k] = v;
    save();
  },

  // Reading progress: last page + set of visited pages per document.
  progress(docId) {
    return (memory.progress[docId] ||= { last: 1, visited: [] });
  },
  visit(docId, page) {
    const p = this.progress(docId);
    p.last = page;
    if (!p.visited.includes(page)) p.visited.push(page);
    p.updated = Date.now();
    memory.recent = [docId, ...memory.recent.filter((d) => d !== docId)].slice(0, 6);
    save();
  },
  get recent() {
    return memory.recent;
  },

  // Bookmarks and notes share one list; a bookmark is a mark without note text.
  get marks() {
    return memory.marks;
  },
  marksFor(docId) {
    return memory.marks.filter((m) => m.docId === docId).sort((a, b) => a.page - b.page);
  },
  isBookmarked(docId, page) {
    return memory.marks.some((m) => m.docId === docId && m.page === page && !m.note);
  },
  toggleBookmark(docId, page) {
    const i = memory.marks.findIndex((m) => m.docId === docId && m.page === page && !m.note);
    if (i >= 0) memory.marks.splice(i, 1);
    else memory.marks.push({ id: crypto.randomUUID(), docId, page, note: '', created: Date.now() });
    save();
    return i < 0;
  },
  addNote(docId, page, note) {
    memory.marks.push({ id: crypto.randomUUID(), docId, page, note, created: Date.now() });
    save();
  },
  removeMark(id) {
    memory.marks = memory.marks.filter((m) => m.id !== id);
    save();
  },
  exportJSON() {
    return JSON.stringify({ marks: memory.marks, progress: memory.progress }, null, 2);
  },
  importJSON(text) {
    const data = JSON.parse(text);
    const seen = new Set(memory.marks.map((m) => m.id));
    for (const m of data.marks || []) if (m && m.docId && m.page && !seen.has(m.id)) memory.marks.push(m);
    for (const [k, v] of Object.entries(data.progress || {})) {
      const p = this.progress(k);
      p.visited = [...new Set([...p.visited, ...(v.visited || [])])];
    }
    save();
  },
};

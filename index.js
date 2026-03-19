const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); 
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// إعدادات الاتصال بقاعدة البيانات لتجنب مهلة الـ 10 ثواني
const dbOptions = {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
};

mongoose.connect(process.env.MONGO_URI, dbOptions)
    .then(() => console.log("✅ Database Connected"))
    .catch(err => console.error("❌ DB Error:", err.message));

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

const commonCSS = `
<style>
    :root { --bg: #f4f7f6; --card: white; --text: #2c3e50; --text-dim: #7f8c8d; --border: #dfe6e9; --accent: #3498db; --imdb-bg: rgba(52, 152, 219, 0.1); --imdb-text: #3498db; }
    body.dark-mode { --bg: #121212; --card: #1e1e1e; --text: #ffffff; --text-dim: #b2bec3; --border: #2d3436; --accent: #f1c40f; --imdb-bg: rgba(241, 196, 15, 0.2); --imdb-text: #f1c40f; }
    body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 20px; transition: 0.3s; line-height: 1.6; }
    .card, .box { background: var(--card); padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); margin-bottom: 20px; border: 1px solid var(--border); }
    .imdb-badge { background: var(--imdb-bg); color: var(--imdb-text); padding: 2px 8px; border-radius: 6px; font-family: monospace; font-weight: bold; font-size: 0.85rem; border: 1px solid var(--imdb-bg); }
    input, select, textarea { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); box-sizing: border-box; }
    .night-toggle { position: fixed; bottom: 20px; left: 20px; z-index: 1000; width: 55px; height: 55px; border-radius: 50%; background: var(--accent); color: #000; border: none; cursor: pointer; font-size: 24px; display: flex; align-items: center; justify-content: center; }
    .btn { padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-weight: bold; color: white; transition: 0.3s; text-decoration: none; display: inline-block; text-align: center; }
    table { width: 100%; border-collapse: collapse; text-align: right; }
    th { background: rgba(0,0,0,0.05); padding: 12px; color: var(--text); }
    td { padding: 12px; border-bottom: 1px solid var(--border); }
</style>`;

const nightModeScript = `
<script>
    function toggleDarkMode() {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
        document.getElementById('nightBtn').innerText = isDark ? '☀️' : '🌙';
    }
    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        window.onload = () => { document.getElementById('nightBtn').innerText = '☀️'; };
    }
</script>`;

app.get("/search-id", async (req, res) => {
    try {
        const response = await axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(req.query.q)}.json`);
        res.json(response.data.d || []);
    } catch (e) { res.json([]); }
});

app.post("/instant-translate", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    try {
        const translated = await translateToArabic(req.body.text, (p) => res.write(`data: Progress: ${p}%\n\n`));
        if (translated) res.write(`data: [RESULT]${JSON.stringify({ result: translated })}\n\n`);
    } catch (e) { res.write(`data: Error\n\n`); } finally { res.end(); }
});

app.post("/adjust-sync", async (req, res) => {
    try {
        const { text, offset } = req.body;
        const seconds = parseFloat(offset);
        const adjustTime = (t) => {
            let [hms, ms] = t.split(',');
            let [h, m, s] = hms.split(':').map(parseFloat);
            let total = (h * 3600000) + (m * 60000) + (s * 1000) + parseInt(ms) + (seconds * 1000);
            if (total < 0) total = 0;
            const pad = (n, l=2) => String(Math.floor(n)).padStart(l, '0');
            return `${pad(total/3600000)}:${pad((total%3600000)/60000)}:${pad((total%60000)/1000)},${pad(total%1000, 3)}`;
        };
        res.send(text.split('\n').map(l => l.includes(' --> ') ? l.split(' --> ').map(adjustTime).join(' --> ') : l).join('\n'));
    } catch (e) { res.send(req.body.text); }
});

app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("Not Found");
    res.send(`<html dir="rtl"><head><meta charset="UTF-8">${commonCSS}</head><body><div class="box">
    <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2>🛠️ تعديل: ${sub.label}</h2>
        <a href="/stats" class="btn" style="background:#7f8c8d;">❌ إلغاء والعودة</a>
    </div>
    <div style="margin:10px 0; display:flex; gap:10px;">
        <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">🤖 تعريب تلقائي</button>
        <button onclick="shiftSync(-0.5)" class="btn" style="background:#e67e22;">-0.5s</button>
        <button onclick="shiftSync(0.5)" class="btn" style="background:#3498db;">+0.5s</button>
    </div>
    <form action="/save-edit" method="POST">
        <input type="hidden" name="fileId" value="${sub.fileId}">
        <textarea id="txt" name="newText" style="height:60vh; font-family:monospace;">${sub.arabicText}</textarea>
        <div style="text-align:center; margin-top:10px;">
            <button type="submit" class="btn" style="background:#2ecc71; padding:15px 50px;">حفظ التغييرات ✅</button>
        </div>
    </form></div><button id="nightBtn" onclick="toggleDarkMode()" class="night-toggle">🌙</button>${nightModeScript}
    <script>
        async function startInstantTranslate() {
            if(!confirm('بدء؟')) return;
            const res = await fetch('/instant-translate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:document.getElementById('txt').value}) });
            const reader = res.body.getReader(); const decoder = new TextDecoder();
            while(true) {
                const {value, done} = await reader.read(); if(done) break;
                const chunk = decoder.decode(value);
                if(chunk.includes('[RESULT]')) {
                    const data = JSON.parse(chunk.split('[RESULT]')[1]);
                    document.getElementById('txt').value = data.result;
                }
            }
        }
        async function shiftSync(offset) {
            const res = await fetch('/adjust-sync', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:document.getElementById('txt').value, offset}) });
            document.getElementById('txt').value = await res.text();
        }
    </script></body></html>`);
});

app.get("/stats", async (req, res) => {
    const total = await Subtitle.countDocuments();
    const latest = await Subtitle.find().sort({ createdAt: -1 }).limit(50);
    const installUrl = `stremio://${process.env.RENDER_EXTERNAL_HOSTNAME}/manifest.json`;
    let rows = latest.map(s => `<tr>
        <td><b>${s.label}</b><br><span class="imdb-badge">${s.imdbId}</span></td>
        <td style="text-align:center;">${s.isAI ? '🤖' : '🇸🇦'}</td>
        <td style="text-align:center;">
            <a href="/edit/${s.fileId}" class="btn" style="background:#3498db; font-size:12px;">تعديل</a>
            <a href="/delete/${s.fileId}" onclick="return confirm('حذف؟')" class="btn" style="background:#e74c3c; font-size:12px;">حذف</a>
        </td>
    </tr>`).join('');

    res.send(`<html dir="rtl"><head><meta charset="UTF-8">${commonCSS}</head><body>
    <div style="max-width:1000px; margin:auto;">
        <div style="text-align:center; margin-bottom:20px;">
            <h1>📊 لوحة التحكم AR.SA</h1>
            <a href="${installUrl}" class="btn" style="background:#8e44ad; padding:10px 30px; border-radius:50px;">+ تثبيت الإضافة</a>
        </div>
        <div class="card">
            <h3>📤 رفع ملف يدوي</h3>
            <form action="/upload-manual" method="POST" enctype="multipart/form-data" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <input name="imdbId" id="mid" placeholder="tt0000000" required>
                <input name="label" id="mlab" placeholder="اسم النسخة" required>
                <input type="file" name="subtitleFile" id="fileInput" accept=".srt" required onchange="extractFileName()" style="grid-column: span 2;">
                <button type="submit" class="btn" style="background:#27ae60; grid-column: span 2;">✅ حفظ الملف</button>
            </form>
        </div>
        <div class="card">
            <h3>📁 أحدث الملفات (إجمالي: ${total})</h3>
            <table><thead><tr><th>المحتوى</th><th>نوع</th><th>إجراء</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
    </div><button id="nightBtn" onclick="toggleDarkMode()" class="night-toggle">🌙</button>${nightModeScript}
    <script>
        function extractFileName() {
            const fileInput = document.getElementById('fileInput');
            const labelInput = document.getElementById('mlab');
            if (fileInput.files.length > 0) {
                labelInput.value = fileInput.files[0].name.replace(".srt", "");
            }
        }
    </script></body></html>`);
});

app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    try {
        const { imdbId, label } = req.body;
        const dbId = `${imdbId}_man_${Date.now()}`;
        await Subtitle.create({ fileId: dbId, imdbId, arabicText: req.file.buffer.toString('utf8'), label, isAI: false });
        res.redirect('/stats');
    } catch (e) { res.status(500).send(e.message); }
});

app.post("/save-edit", async (req, res) => {
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { arabicText: req.body.newText });
    res.send("<script>alert('تم!'); window.location.href='/stats';</script>");
});

app.get("/delete/:fileId", async (req, res) => { await Subtitle.deleteOne({ fileId: req.params.fileId }); res.redirect('/stats'); });

app.get("/sub/:fileId.srt", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId.replace('.srt', '') });
    if (sub) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(sub.arabicText);
    } else res.status(404).send("Not found");
});

app.use("/", getRouter(addonInterface));
app.listen(process.env.PORT || 10000);

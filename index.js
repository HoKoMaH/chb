const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); 
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

/**
 * 1. إعدادات استقبال البيانات والملفات الضخمة
 */
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * 2. الاتصال بقاعدة البيانات (MongoDB)
 */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] Connected Successfully"))
    .catch(err => console.error("❌ [DATABASE] Connection Error:", err));

/**
 * 3. تعريف الموديل (Subtitle Schema)
 */
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

/**
 * 4. CSS المطور (الألوان والوضع الليلي والـ ID)
 */
const commonCSS = `
<style>
    :root { 
        --bg: #f4f7f6; --card: white; --text: #2c3e50; --text-dim: #7f8c8d; 
        --border: #dfe6e9; --accent: #3498db; --imdb-bg: rgba(52, 152, 219, 0.1); --imdb-text: #3498db;
    }
    body.dark-mode { 
        --bg: #121212; --card: #1e1e1e; --text: #ffffff; --text-dim: #b2bec3; 
        --border: #2d3436; --accent: #f1c40f; --imdb-bg: rgba(241, 196, 15, 0.2); --imdb-text: #f1c40f;
    }
    
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 20px; transition: 0.3s; line-height: 1.6; }
    .card, .box { background: var(--card); padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); margin-bottom: 20px; border: 1px solid var(--border); }
    
    h1, h2, h3 { color: var(--text); }
    
    .imdb-badge {
        background: var(--imdb-bg);
        color: var(--imdb-text);
        padding: 2px 8px;
        border-radius: 6px;
        font-family: monospace;
        font-weight: bold;
        font-size: 0.85rem;
        border: 1px solid var(--imdb-bg);
    }

    input, select, textarea { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); box-sizing: border-box; }
    
    .night-toggle {
        position: fixed; bottom: 20px; left: 20px; z-index: 1000;
        width: 55px; height: 55px; border-radius: 50%;
        background: var(--accent); color: #000; border: none; cursor: pointer;
        font-size: 24px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
    }

    .btn { padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-weight: bold; color: white; transition: 0.3s; text-decoration: none; display: inline-block; text-align: center; }
    .btn:hover { opacity: 0.8; transform: translateY(-1px); }
    
    table { width: 100%; border-collapse: collapse; text-align: right; margin-top: 10px; }
    th { background: rgba(0,0,0,0.05); padding: 12px; color: var(--text); }
    body.dark-mode th { background: rgba(255,255,255,0.05); }
    td { padding: 12px; border-bottom: 1px solid var(--border); }
</style>
`;

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
</script>
`;

/**
 * 5. المسارات التقنية
 */
app.get("/search-id", async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    try {
        const response = await axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`);
        res.json(response.data.d || []);
    } catch (e) { res.status(500).json([]); }
});

app.post("/instant-translate", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const sendLog = (msg) => res.write(`data: ${msg.replace(/\n/g, ' ')}\n\n`);
    try {
        sendLog("🚀 بدء التعريب...");
        const translated = await translateToArabic(req.body.text, (p) => sendLog(`⏳ جاري المعالجة: ${p}%`));
        if (translated) {
            sendLog("✅ اكتمل بنجاح");
            res.write(`data: [RESULT]${JSON.stringify({ result: translated })}\n\n`);
        }
    } catch (e) { sendLog(`❌ خطأ: ${e.message}`); } finally { res.end(); }
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
    } catch (e) { res.status(500).send(req.body.text); }
});

/**
 * 6. واجهة التعديل (مع زر الإلغاء)
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    res.send(`
    <html dir="rtl"><head><meta charset="UTF-8"><title>المحرر | AR.SA</title>${commonCSS}</head>
    <body>
        <div class="box">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h2>🛠️ محرر الترجمة: ${sub.label}</h2>
                <div>
                    <button onclick="downloadSrt()" class="btn" style="background:#34495e; margin-left:5px;">📥 تحميل SRT</button>
                    <a href="/stats" class="btn" style="background:#7f8c8d;">❌ إلغاء</a>
                </div>
            </div>
            <div id="pCont" style="width:100%; background:#eee; height:8px; border-radius:10px; margin-bottom:10px; display:none; overflow:hidden;"><div id="pBar" style="width:0%; height:100%; background:#2ecc71; transition:0.3s;"></div></div>
            <div id="logWin" style="background:#000; color:#0f0; padding:10px; border-radius:8px; font-family:monospace; font-size:12px; max-height:80px; overflow-y:auto; margin-bottom:10px; display:none;"></div>
            
            <div style="padding:10px; background:rgba(0,0,0,0.03); border-radius:8px; margin-bottom:10px; display:flex; gap:10px; align-items:center;">
                <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">🤖 تعريب تلقائي</button>
                <button onclick="shiftSync(-0.5)" class="btn" style="background:#e67e22;">-0.5s</button>
                <button onclick="shiftSync(0.5)" class="btn" style="background:#3498db;">+0.5s</button>
                <span id="status" style="font-weight:bold; color:#27ae60;"></span>
            </div>

            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText" style="height:60vh; font-family:monospace;">${sub.arabicText}</textarea>
                <div style="text-align:center; margin-top:20px; display:flex; justify-content:center; gap:15px;">
                    <button type="submit" class="btn" style="background:#2ecc71; padding:12px 60px; font-size:1.1rem;">حفظ التغييرات ✅</button>
                    <a href="/stats" class="btn" style="background:#95a5a6; padding:12px 30px; font-size:1.1rem;">العودة للخلف</a>
                </div>
            </form>
        </div>
        <button id="nightBtn" onclick="toggleDarkMode()" class="night-toggle">🌙</button>
        ${nightModeScript}
        <script>
            async function startInstantTranslate() {
                if(!confirm('بدء التعريب؟')) return;
                const logW=document.getElementById('logWin'); logW.style.display='block'; logW.innerHTML='';
                const pBar=document.getElementById('pBar'); document.getElementById('pCont').style.display='block';
                const res = await fetch('/instant-translate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:document.getElementById('txt').value}) });
                const reader = res.body.getReader(); const decoder = new TextDecoder();
                while(true) {
                    const {value, done} = await reader.read(); if(done) break;
                    const chunk = decoder.decode(value);
                    if(chunk.includes('[RESULT]')) {
                        const data = JSON.parse(chunk.split('[RESULT]')[1]);
                        document.getElementById('txt').value = data.result;
                        document.getElementById('status').innerText = '✅ اكتمل';
                    } else {
                        logW.innerHTML += '<div>' + chunk + '</div>';
                        const p = chunk.match(/\\d+%/); if(p) pBar.style.width = p[0];
                    }
                }
            }
            async function shiftSync(offset) {
                const res = await fetch('/adjust-sync', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:document.getElementById('txt').value, offset}) });
                document.getElementById('txt').value = await res.text();
            }
            function downloadSrt() {
                const blob = new Blob([document.getElementById('txt').value], {type:'text/plain'});
                const a = document.createElement('a'); a.download = "subtitle.srt"; a.href = window.URL.createObjectURL(blob); a.click();
            }
        </script>
    </body></html>`);
});

/**
 * 7. لوحة التحكم (Stats Page)
 */
app.get("/stats", async (req, res) => {
    const total = await Subtitle.countDocuments();
    const ai = await Subtitle.countDocuments({ isAI: true });
    const latest = await Subtitle.find().sort({ createdAt: -1 }).limit(50);
    const installUrl = `stremio://${process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com"}/manifest.json`;

    let rows = latest.map(s => {
        const shortLabel = s.label.length > 50 ? s.label.substring(0, 47) + "..." : s.label;
        const timeAgo = new Date(s.createdAt).toLocaleDateString('ar-EG');
        return `
        <tr>
            <td style="padding:15px 12px;">
                <div style="font-weight:bold; color:var(--text); margin-bottom:4px;">${shortLabel}</div>
                <small style="display:flex; align-items:center; gap:8px; opacity:0.8;">
                    <span class="imdb-badge">${s.imdbId}</span>
                    <span style="color:var(--text-dim);">📅 ${timeAgo}</span>
                </small>
            </td>
            <td style="text-align:center;">
                <span style="background:${s.isAI ? '#8e44ad' : '#27ae60'}; color:white; padding:3px 10px; border-radius:6px; font-size:11px; font-weight:bold;">
                    ${s.isAI ? '🤖 AI' : '🇸🇦 أصلية'}
                </span>
            </td>
            <td style="text-align:center; white-space:nowrap;">
                <a href="/edit/${s.fileId}" class="btn" style="background:#3498db; font-size:12px; padding:6px 14px;">تعديل</a>
                <a href="/delete/${s.fileId}" onclick="return confirm('حذف؟')" class="btn" style="background:#e74c3c; font-size:12px; padding:6px 14px; margin-right:5px;">حذف</a>
            </td>
        </tr>`;
    }).join('');

    res.send(`
    <html dir="rtl"><head><meta charset="UTF-8"><title>أدارة ترجمات| Stremio</title>${commonCSS}</head>
    <body>
        <div style="max-width:1100px; margin:auto;">
            <div style="text-align:center; margin-bottom:30px;">
                <h1>📊  أدارة ترجمات Stremio 📊</h1>
                <a href="${installUrl}" class="btn" style="background:#8e44ad; padding:15px 40px; border-radius:50px; font-size:1.1rem;">+ تثبيت الإضافة في Stremio</a>
            </div>

            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:20px; margin-bottom:30px; text-align:center;">
                <div class="card" style="border-top:5px solid #3498db;"><h3>الإجمالي</h3><h2 style="font-size:2rem;">${total}</h2></div>
                <div class="card" style="border-top:5px solid #8e44ad;"><h3>🤖 تعريب AI</h3><h2 style="font-size:2rem;">${ai}</h2></div>
                <div class="card" style="border-top:5px solid #27ae60;"><h3>🇸🇦 أصلية</h3><h2 style="font-size:2rem;">${total - ai}</h2></div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:25px;">
                <div class="card">
                    <h3>🔍 بحث IMDb ID</h3>
                    <input id="q" placeholder="ابحث عن اسم الفيلم..." oninput="autoSearch()">
                    <div id="r" style="margin-top:10px; max-height:250px; overflow:auto; border-radius:8px;"></div>
                </div>
                <div class="card">
                    <h3>📤 رفع ملف يدوي</h3>
                    <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                        <select name="type" id="type" onchange="document.getElementById('sF').style.display=this.value==='series'?'flex':'none'">
                            <option value="movie">🎬 فيلم</option><option value="series">📺 مسلسل</option>
                        </select>
                        <input name="imdbId" id="mid" placeholder="tt0000000" required>
                        <div id="sF" style="display:none; gap:10px;"><input type="number" name="season" placeholder="موسم" style="width:50%"><input type="number" name="episode" placeholder="حلقة" style="width:50%"></div>
                        <input name="label" id="mlab" placeholder="اسم النسخة" required>
                        <input type="file" name="subtitleFile" accept=".srt" required>
                        <button type="submit" class="btn" style="background:#27ae60; width:100%; padding:15px; margin-top:5px;">✅ حفظ الملف</button>
                    </form>
                </div>
            </div>

            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3 style="margin:0;">📁 أحدث الملفات</h3>
                    <a href="/delete-all-now" onclick="return confirm('حذف الكل؟')" class="btn" style="background:#c0392b; font-size:0.9rem;">⚠️ مسح السجل</a>
                </div>
                <table>
                    <thead><tr><th style="width:60%;">المحتوى والمعرف</th><th style="text-align:center;">المصدر</th><th style="text-align:center;">خيارات</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
        <button id="nightBtn" onclick="toggleDarkMode()" class="night-toggle">🌙</button>
        ${nightModeScript}
        <script>
            let t; function autoSearch(){
                clearTimeout(t); const q=document.getElementById('q').value;
                if(q.length<2) return;
                t=setTimeout(async()=>{
                    const res=await fetch('/search-id?q='+q); const d=await res.json();
                    document.getElementById('r').innerHTML = d.map(i=>\`<div style="padding:12px; border-bottom:1px solid var(--border); cursor:pointer;" onclick="document.getElementById('mid').value='\${i.id}'; document.getElementById('type').value='\${i.q==='TV series'?'series':'movie'}';"><b>\${i.l}</b> (\${i.y})</div>\`).join('');
                },500);
            }
        </script>
    </body></html>`);
});

/**
 * 8. باقي المسارات (Upload, Delete, Serve)
 */
app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    try {
        let { imdbId, type, season, episode, label } = req.body;
        let technicalId = type === 'series' ? `${imdbId}:${season || 1}:${episode || 1}` : imdbId;
        const dbId = `${technicalId.replace(/:/g, '_')}_man_${Date.now()}`;
        await Subtitle.create({ fileId: dbId, imdbId: technicalId, arabicText: req.file.buffer.toString('utf8'), label, isAI: false });
        res.redirect('/stats');
    } catch (e) { res.status(500).send(e.message); }
});

app.post("/save-edit", async (req, res) => {
    const isAr = /[\u0600-\u06FF]/.test(req.body.newText);
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { arabicText: req.body.newText, isAI: !isAr });
    res.send("<script>alert('تم الحفظ!'); window.location.href='/stats';</script>");
});

app.get("/delete/:fileId", async (req, res) => { await Subtitle.deleteOne({ fileId: req.params.fileId }); res.redirect('/stats'); });
app.get("/delete-all-now", async (req, res) => { await Subtitle.deleteMany({}); res.redirect('/stats'); });

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

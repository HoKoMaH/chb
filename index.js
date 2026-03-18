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
 * 1. إعدادات استقبال البيانات (حل مشكلة الملفات الكبيرة)
 */
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

/**
 * 2. الاتصال بقاعدة البيانات
 */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] Connected Successfully"))
    .catch(err => console.error("❌ [DATABASE] Connection Error:", err));

/**
 * 3. تعريف الموديل (Schema)
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
 * 4. محرك بحث IMDb ID السريع
 */
app.get("/search-id", async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    try {
        const response = await axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`);
        res.json(response.data.d || []);
    } catch (e) { res.status(500).json([]); }
});

/**
 * 5. مسار تعديل المزامنة (Offset Sync) ⏱️
 */
app.post("/adjust-sync", async (req, res) => {
    try {
        const { text, offset } = req.body;
        const seconds = parseFloat(offset);
        if (isNaN(seconds)) return res.send(text);

        const adjustTime = (timeStr) => {
            let [hms, ms] = timeStr.split(',');
            let [h, m, s] = hms.split(':').map(parseFloat);
            let totalMs = (h * 3600000) + (m * 60000) + (s * 1000) + parseInt(ms);
            totalMs += (seconds * 1000);
            if (totalMs < 0) totalMs = 0;

            let nh = Math.floor(totalMs / 3600000);
            let nm = Math.floor((totalMs % 3600000) / 60000);
            let ns = Math.floor((totalMs % 60000) / 1000);
            let nms = totalMs % 1000;
            return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:${String(ns).padStart(2, '0')},${String(nms).padStart(3, '0')}`;
        };

        const lines = text.split('\n');
        const updatedLines = lines.map(line => {
            if (line.includes(' --> ')) {
                let [start, end] = line.split(' --> ');
                return `${adjustTime(start)} --> ${adjustTime(end)}`;
            }
            return line;
        });
        res.send(updatedLines.join('\n'));
    } catch (e) { res.status(500).send(req.body.text); }
});

/**
 * 6. واجهة التعديل والتحكم الكامل
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    
    res.send(`
    <html dir="rtl"><body style="font-family:'Segoe UI', sans-serif; padding:20px; background:#f4f7f6;">
        <div style="max-width:1000px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="margin:0 0 15px 0;">🛠️ محرر الترجمة: ${sub.label}</h2>
            
            <div style="background:#f8f9fa; padding:15px; border-radius:10px; margin-bottom:15px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <b>🤖 ذكاء اصطناعي:</b>
                <button onclick="instantTranslate()" style="background:#8e44ad; color:white; border:none; padding:8px 15px; border-radius:5px; cursor:pointer;">تعريب النص بالكامل</button>
                <b style="margin-right:20px;">⏱️ مزامنة:</b>
                <button onclick="shiftSync(-0.5)" style="background:#e67e22; color:white; border:none; padding:8px 12px; border-radius:5px; cursor:pointer;">-0.5s</button>
                <button onclick="shiftSync(0.5)" style="background:#3498db; color:white; border:none; padding:8px 12px; border-radius:5px; cursor:pointer;">+0.5s</button>
                <span id="status" style="color:#27ae60; font-weight:bold; margin-right:10px;"></span>
            </div>

            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText" style="width:100%; height:60vh; padding:15px; border-radius:10px; border:1px solid #ddd; font-family:monospace; line-height:1.6;">${sub.arabicText}</textarea>
                <div style="text-align:center; margin-top:20px;">
                    <button type="submit" style="background:#2ecc71; color:white; padding:15px 50px; border:none; border-radius:10px; cursor:pointer; font-weight:bold; font-size:16px;">حفظ واعتماد التعديلات ✅</button>
                    <a href="/stats" style="margin-right:20px; color:#666; text-decoration:none;">إلغاء</a>
                </div>
            </form>
        </div>
        <script>
            async function instantTranslate() {
                if(!confirm('هل تريد بدء التعريب الآلي؟')) return;
                document.getElementById('status').innerText = '⏳ جاري التعريب..';
                const res = await fetch('/instant-translate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ text: document.getElementById('txt').value })
                });
                const result = await res.text();
                if(result) { document.getElementById('txt').value = result; document.getElementById('status').innerText = '✅ تم التعريب'; }
            }
            async function shiftSync(offset) {
                document.getElementById('status').innerText = '⏳ معالجة التوقيت..';
                const res = await fetch('/adjust-sync', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ text: document.getElementById('txt').value, offset })
                });
                const result = await res.text();
                if(result) { document.getElementById('txt').value = result; document.getElementById('status').innerText = '✅ تم تعديل المزامنة'; }
            }
        </script>
    </body></html>`);
});

/**
 * 7. واجهة الإحصائيات (التصميم الأصلي المستعاد)
 */
app.get("/stats", async (req, res) => {
    try {
        const totalSubs = await Subtitle.countDocuments();
        const aiSubs = await Subtitle.countDocuments({ isAI: true });
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
        
        const installUrl = `stremio://${process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com"}/manifest.json`;

        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: 500;">${sub.label}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="padding: 4px 10px; border-radius: 20px; font-size: 11px; background: ${sub.isAI ? '#e8f5e9; color: #2e7d32;' : '#fff8e1; color: #f57f17;'}">
                        ${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}
                    </span>
                </td>
                <td style="padding: 12px; text-align: center;">
                    <a href="/edit/${sub.fileId}" style="text-decoration:none; background:#3498db; color:white; padding:5px 12px; border-radius:6px; font-size:11px;">تعديل 📝</a>
                    <a href="/delete/${sub.fileId}" onclick="return confirm('حذف؟')" style="text-decoration:none; background:#e74c3c; color:white; padding:5px 12px; border-radius:6px; font-size:11px; margin-right:5px;">حذف 🗑️</a>
                </td>
            </tr>
        `).join('');

        res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>AR.SA Dashboard</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; padding: 20px; }
            .container { max-width: 900px; margin: auto; }
            .install-btn { display: inline-block; background: #8e44ad; color: white; padding: 12px 30px; border-radius: 50px; text-decoration: none; font-weight: bold; margin-bottom: 30px; }
            .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
            .card { background: white; padding: 15px; border-radius: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
            .admin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
            .admin-card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
            input, button { width: 100%; padding: 10px; margin: 5px 0; border-radius: 8px; border: 1px solid #ddd; box-sizing: border-box; }
        </style></head>
        <body>
            <div class="container" style="text-align:center;">
                <h1>📊 لوحة تحكم AR.SA الذكية</h1>
                <a href="${installUrl}" class="install-btn">+ تثبيت الإضافة في Stremio</a>
                <div class="stats-grid">
                    <div class="card" style="border-top: 4px solid #3498db;"><h3>الإجمالي</h3><p>${totalSubs}</p></div>
                    <div class="card" style="border-top: 4px solid #2ecc71;"><h3>بواسطة AI 🤖</h3><p>${aiSubs}</p></div>
                    <div class="card" style="border-top: 4px solid #f1c40f;"><h3>أصلي</h3><p>${totalSubs - aiSubs}</p></div>
                </div>
                <div class="admin-grid">
                    <div class="admin-card">
                        <h3>🔍 بحث IMDb ID</h3>
                        <input id="movieSearch" placeholder="اسم الفيلم..."><button onclick="searchIMDb()" style="background:#f1c40f; cursor:pointer;">بحث</button>
                        <div id="results" style="text-align:right; font-size:12px; margin-top:10px;"></div>
                    </div>
                    <div class="admin-card">
                        <h3>📤 رفع يدوي (SRT)</h3>
                        <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                            <input name="imdbId" placeholder="IMDb ID (tt...)" required>
                            <input name="label" placeholder="اسم النسخة" required>
                            <input type="file" name="subtitleFile" accept=".srt" required>
                            <button type="submit" style="background:#27ae60; color:white; cursor:pointer;">رفع واعتماد</button>
                        </form>
                    </div>
                </div>
                <div style="background:white; border-radius:12px; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,0.05);">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead style="background:#f8f9fa;"><tr><th>المحتوى</th><th>النوع</th><th>الإجراء</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
            <script>
                async function searchIMDb() {
                    const res = await fetch('/search-id?q=' + document.getElementById('movieSearch').value);
                    const data = await res.json();
                    document.getElementById('results').innerHTML = data.slice(0,5).map(i => '<li>'+i.l+' ('+i.y+'): <code>'+i.id+'</code></li>').join('');
                }
            </script>
        </body></html>`);
    } catch (e) { res.status(500).send("Error"); }
});

/**
 * 8. المسارات الخلفية (Backend Routes)
 */
app.post("/instant-translate", async (req, res) => {
    const translated = await translateToArabic(req.body.text);
    res.send(translated || "");
});

app.post("/save-edit", async (req, res) => {
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { arabicText: req.body.newText });
    res.send("<script>alert('تم الحفظ!'); window.location.href='/stats';</script>");
});

app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    const fileId = `${req.body.imdbId.replace(/:/g, '_')}_manual_${Date.now()}`;
    await Subtitle.findOneAndUpdate({ fileId }, {
        imdbId: req.body.imdbId.trim(),
        arabicText: req.file.buffer.toString('utf8'),
        label: req.body.label,
        isAI: false
    }, { upsert: true });
    res.redirect('/stats');
});

app.get("/delete/:fileId", async (req, res) => {
    await Subtitle.deleteOne({ fileId: req.params.fileId });
    res.redirect('/stats');
});

app.get("/sub/:fileId.srt", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId.replace('.srt', '') });
    if (sub) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(sub.arabicText);
    } else res.status(404).send("Not found");
});

app.use("/", getRouter(addonInterface));
app.listen(process.env.PORT || 10000, () => console.log(`🚀 Server Online`));

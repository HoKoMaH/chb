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
 * 4. محرك بحث IMDb ID
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
 * 5. مسار التعريب المباشر
 */
app.post("/instant-translate", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); 

    const sendLog = (msg) => {
        const cleanMsg = msg.replace(/\n/g, ' ');
        res.write(`data: ${cleanMsg}\n\n`);
    };

    try {
        sendLog("🚀 بدء عملية التعريب الشامل...");
        if (!req.body.text || req.body.text.length < 10) throw new Error("النص قصير جداً.");
        
        const translated = await translateToArabic(req.body.text, (percent) => {
            sendLog(`⏳ جاري المعالجة: ${percent}%`);
        });

        if (translated && translated.length > 10) {
            const resultData = JSON.stringify({ result: translated });
            res.write(`data: [RESULT]${resultData}\n\n`);
        } else {
            throw new Error("فشل التعريب.");
        }
    } catch (e) {
        sendLog(`❌ خطأ: ${e.message}`);
    } finally {
        res.end();
    }
});

/**
 * 6. مسار تعديل المزامنة
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
 * 7. واجهة التعديل
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    res.send(`
    <html dir="rtl"><head><meta charset="UTF-8"><title>محرر الترجمة | AR.SA</title>
    <style>
        body { font-family:sans-serif; padding:20px; background:#f4f7f6; color:#333; }
        .box { max-width:1000px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1); }
        textarea { width:100%; height:55vh; padding:15px; border-radius:10px; font-family:monospace; border:1px solid #ddd; font-size:14px; line-height:1.6; }
        .log-win { background:#1e1e1e; color:#00ff00; padding:15px; border-radius:8px; font-family:monospace; font-size:13px; max-height:120px; overflow-y:auto; margin-bottom:15px; display:none; border-right:5px solid #8e44ad; }
        .progress-container { width: 100%; background: #eee; height: 10px; border-radius: 10px; margin-bottom: 15px; display: none; overflow: hidden; }
        .progress-bar { width: 0%; height: 100%; background: #2ecc71; transition: width 0.4s ease; }
        .btn { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight:bold; color:white; transition:0.3s; }
    </style></head>
    <body>
        <div class="box">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h2 style="margin:0;">🛠️ محرر الترجمة: ${sub.label}</h2>
                <button onclick="downloadSrt()" class="btn" style="background:#34495e;">📥 تحميل SRT</button>
            </div>
            <div id="pCont" class="progress-container"><div id="pBar" class="progress-bar"></div></div>
            <div id="logWin" class="log-win"></div>
            <div style="background:#f8f9fa; padding:15px; border-radius:10px; margin-bottom:15px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <b>🤖 AI:</b> 
                <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">ابدأ التعريب اليدوي</button>
                <b style="margin-right:20px;">⏱️ مزامنة:</b>
                <button onclick="shiftSync(-0.5)" class="btn" style="background:#e67e22;">-0.5s</button>
                <button onclick="shiftSync(0.5)" class="btn" style="background:#3498db;">+0.5s</button>
                <span id="status" style="color:#27ae60; font-weight:bold; margin-right:10px;"></span>
            </div>
            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText">${sub.arabicText}</textarea>
                <div style="text-align:center; margin-top:20px;">
                    <button type="submit" class="btn" style="background:#2ecc71; padding:15px 50px; font-size:16px;">حفظ ✅</button>
                    <a href="/stats" style="margin-right:20px; color:#666; text-decoration:none;">إلغاء</a>
                </div>
            </form>
        </div>
        <script>
            async function startInstantTranslate() {
                if(!confirm('هل تريد تعريب هذا الملف؟')) return;
                const response = await fetch('/instant-translate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value }) });
                const reader = response.body.getReader(); const decoder = new TextDecoder();
                while (true) {
                    const { value, done } = await reader.read(); if (done) break;
                    const chunk = decoder.decode(value);
                    if (chunk.includes('[RESULT]')) {
                        const parsed = JSON.parse(chunk.split('[RESULT]')[1].split('\\n\\n')[0]);
                        document.getElementById('txt').value = parsed.result;
                    }
                }
            }
            async function shiftSync(offset) {
                const res = await fetch('/adjust-sync', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value, offset }) });
                const result = await res.text();
                if(result) document.getElementById('txt').value = result;
            }
            function downloadSrt() {
                const blob = new Blob([document.getElementById('txt').value], { type: 'text/plain' });
                const a = document.createElement('a'); a.download = "subtitle.srt"; a.href = window.URL.createObjectURL(blob); a.click();
            }
        </script>
    </body></html>`);
});

/**
 * 8. لوحة التحكم (Stats Page)
 */
app.get("/stats", async (req, res) => {
    try {
        const totalSubs = await Subtitle.countDocuments();
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
        const installUrl = `stremio://${process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com"}/manifest.json`;

        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-size: 13px;">${sub.label}</td>
                <td style="padding: 12px; text-align: center;">${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}</td>
                <td style="padding: 12px; text-align: center;">
                    <a href="/edit/${sub.fileId}" style="text-decoration:none; background:#3498db; color:white; padding:5px 10px; border-radius:5px; font-size:12px;">تعديل</a>
                    <button onclick="deleteSingle('${sub.fileId}')" style="background:#e74c3c; color:white; padding:5px 10px; border-radius:5px; font-size:12px; border:none; cursor:pointer;">حذف</button>
                </td>
            </tr>`).join('');

        res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>إدارة الترجمات</title>
        <style>
            body { font-family: sans-serif; background: #f4f7f6; padding: 20px; }
            .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 20px; }
            input, select, button { width: 100%; padding: 10px; margin: 5px 0; border-radius: 8px; border: 1px solid #ddd; box-sizing: border-box; }
            .danger-btn { background:#c0392b; color:white; border:none; padding:10px; border-radius:8px; cursor:pointer; font-weight:bold; }
        </style></head>
        <body>
            <div style="max-width: 900px; margin: auto; text-align:center;">
                <h1>📊 إدارة ترجمات Stremio</h1>
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0;">📁 الترجمات الأخيرة</h3>
                        <button onclick="deleteAllSubtitles()" class="danger-btn">حذف الكل ⚠️</button>
                    </div>
                    <table style="width:100%; border-collapse:collapse; text-align:right;">
                        <thead><tr style="background:#f8f9fa;"><th>المحتوى</th><th>النوع</th><th>الإجراء</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
            <script>
                function deleteSingle(id) {
                    const pass = prompt("الرجاء إدخال الرقم السري للحذف:");
                    if (pass === "8182") {
                        if(confirm("تأكيد الحذف؟")) window.location.href = "/delete/" + id + "?pass=" + pass;
                    } else if (pass !== null) alert("❌ الرقم السري خاطئ!");
                }
                function deleteAllSubtitles() {
                    const pass = prompt("الرجاء إدخال الرقم السري لحذف الكل:");
                    if (pass === "8182") {
                        if(confirm("⚠️ سيتم مسح القاعدة بالكامل! هل أنت متأكد؟")) window.location.href = "/delete-all-now?pass=" + pass;
                    } else if (pass !== null) alert("❌ الرقم السري خاطئ!");
                }
            </script>
        </body></html>`);
    } catch (e) { res.status(500).send("Error"); }
});

/**
 * 9. مسارات الحذف المؤمنة
 */
app.get("/delete/:fileId", async (req, res) => {
    if (req.query.pass === "8182") {
        await Subtitle.deleteOne({ fileId: req.params.fileId });
        res.redirect('/stats');
    } else res.status(403).send("Wrong Password");
});

app.get("/delete-all-now", async (req, res) => {
    if (req.query.pass === "8182") {
        await Subtitle.deleteMany({});
        res.redirect('/stats');
    } else res.status(403).send("Wrong Password");
});

app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    try {
        let { imdbId, type, season, episode, label } = req.body;
        let technicalId = type === 'series' ? `${imdbId}:${season}:${episode}` : imdbId;
        const dbFileId = `${technicalId.replace(/:/g, '_')}_manual_${Date.now()}`;
        await Subtitle.findOneAndUpdate({ fileId: dbFileId }, {
            imdbId: technicalId, arabicText: req.file.buffer.toString('utf8'), label, isAI: false
        }, { upsert: true });
        res.redirect('/stats');
    } catch (e) { res.status(500).send(e.message); }
});

app.post("/save-edit", async (req, res) => {
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { 
        arabicText: req.body.newText, isAI: req.body.newText.length > 100 
    });
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
app.listen(process.env.PORT || 10000);

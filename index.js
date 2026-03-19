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
 * 2. الاتصال بقاعدة البيانات (MongoDB) - إعدادات الاستقرار القصوى
 */
const dbOptions = {
    serverSelectionTimeoutMS: 60000,
    connectTimeoutMS: 60000,
    family: 4, // تجاوز مشاكل الـ DNS في Render
    heartbeatFrequencyMS: 10000,
    socketTimeoutMS: 45000,
};

mongoose.connect(process.env.MONGO_URI, dbOptions)
    .then(() => console.log("✅ [DATABASE] Connected Successfully!"))
    .catch(err => {
        console.error("❌ [DATABASE] Connection Failed!");
        console.error("Reason:", err.message);
    });

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
        const response = await axios.get("https://v3.sg.media-imdb.com/suggestion/x/" + encodeURIComponent(query) + ".json");
        res.json(response.data.d || []);
    } catch (e) { res.status(500).json([]); }
});

/**
 * 5. مسار التعريب المباشر (Streaming Response)
 */
app.post("/instant-translate", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); 

    try {
        if (!req.body.text || req.body.text.length < 10) throw new Error("النص قصير جداً.");
        
        const translated = await translateToArabic(req.body.text, (percent) => {
            res.write("data: ⏳ جاري المعالجة: " + percent + "%\n\n");
        });

        if (translated && translated.length > 10) {
            const resultData = JSON.stringify({ result: translated });
            res.write("data: [RESULT]" + resultData + "\n\n");
        } else {
            throw new Error("فشل التعريب.");
        }
    } catch (e) {
        res.write("data: ❌ خطأ: " + e.message + "\n\n");
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
            return String(nh).padStart(2, '0') + ":" + String(nm).padStart(2, '0') + ":" + String(ns).padStart(2, '0') + "," + String(nms).padStart(3, '0');
        };

        const updatedLines = text.split('\n').map(line => {
            if (line.includes(' --> ')) {
                let [start, end] = line.split(' --> ');
                return adjustTime(start) + " --> " + adjustTime(end);
            }
            return line;
        });
        res.send(updatedLines.join('\n'));
    } catch (e) { res.status(500).send(req.body.text); }
});

/**
 * 7. واجهة التعديل (Edit Page)
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    
    const pageHtml = `
    <html dir="rtl"><head><meta charset="UTF-8"><title>محرر AR.SA</title>
    <style>
        body { font-family:sans-serif; padding:20px; background:#f4f7f6; }
        .box { max-width:1000px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1); }
        textarea { width:100%; height:55vh; padding:15px; border-radius:10px; font-family:monospace; border:1px solid #ddd; }
        .btn { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight:bold; color:white; }
    </style></head>
    <body>
        <div class="box">
            <h2>🛠️ محرر الترجمة: ${sub.label}</h2>
            <div style="background:#f8f9fa; padding:15px; border-radius:10px; margin-bottom:15px; display:flex; gap:10px;">
                <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">🤖 تعريب تلقائي</button>
                <button onclick="shiftSync(-0.5)" class="btn" style="background:#e67e22;">-0.5s</button>
                <button onclick="shiftSync(0.5)" class="btn" style="background:#3498db;">+0.5s</button>
            </div>
            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText">${sub.arabicText}</textarea>
                <div style="text-align:center; margin-top:20px;">
                    <button type="submit" class="btn" style="background:#2ecc71; padding:15px 50px;">حفظ التغييرات ✅</button>
                </div>
            </form>
        </div>
        <script>
            async function startInstantTranslate() {
                if(!confirm('ابدأ التعريب؟')) return;
                const response = await fetch('/instant-translate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value }) });
                const reader = response.body.getReader(); const decoder = new TextDecoder();
                while (true) {
                    const { value, done } = await reader.read(); if (done) break;
                    const chunk = decoder.decode(value);
                    if (chunk.includes('[RESULT]')) {
                        const cleanJson = chunk.split('[RESULT]')[1].split('\\n\\n')[0];
                        document.getElementById('txt').value = JSON.parse(cleanJson).result;
                        alert('تم التعريب!');
                    }
                }
            }
            async function shiftSync(offset) {
                const res = await fetch('/adjust-sync', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value, offset }) });
                document.getElementById('txt').value = await res.text();
            }
        </script>
    </body></html>`;
    res.send(pageHtml);
});

/**
 * 8. لوحة التحكم (Stats Page)
 */
app.get("/stats", async (req, res) => {
    try {
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
        const installUrl = "stremio://" + (process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com") + "/manifest.json";

        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px;">${sub.label}</td>
                <td style="padding: 12px; text-align: center;">${sub.isAI ? '🤖' : '🇸🇦'}</td>
                <td style="padding: 12px; text-align: center;">
                    <a href="/edit/${sub.fileId}" style="color:#3498db;">تعديل</a> | 
                    <a href="/delete/${sub.fileId}" style="color:#e74c3c;">حذف</a>
                </td>
            </tr>`).join('');

        res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>إدارة AR.SA</title>
        <style>body{font-family:sans-serif; background:#f4f7f6; padding:20px;}.card{background:white; padding:20px; border-radius:12px; margin-bottom:20px;}</style></head>
        <body>
            <div style="max-width: 900px; margin: auto;">
                <h1 style="text-align:center;">📊 لوحة تحكم AR.SA</h1>
                <div style="text-align:center; margin-bottom:20px;"><a href="${installUrl}" style="background:#8e44ad; color:white; padding:10px 20px; border-radius:50px; text-decoration:none;">+ تثبيت الإضافة</a></div>
                <div class="card">
                    <h3>📤 رفع يدوي / بحث</h3>
                    <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                        <input name="imdbId" placeholder="tt..." required style="width:20%; padding:8px;">
                        <input name="label" placeholder="اسم النسخة" required style="width:40%; padding:8px;">
                        <input type="file" name="subtitleFile" accept=".srt" required>
                        <button type="submit" style="padding:8px 20px; background:#27ae60; color:white; border:none; border-radius:5px;">حفظ</button>
                    </form>
                </div>
                <div class="card">
                    <table style="width:100%; text-align:right; border-collapse:collapse;">
                        <thead><tr style="background:#eee;"><th>المحتوى</th><th>النوع</th><th>الإجراء</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </body></html>`);
    } catch (e) { res.status(500).send("Error"); }
});

/**
 * 9. مسارات التشغيل النهائي
 */
app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    try {
        let { imdbId, label } = req.body;
        const dbFileId = imdbId.replace(/:/g, '_') + "_manual_" + Date.now();
        await Subtitle.create({ fileId: dbFileId, imdbId, arabicText: req.file.buffer.toString('utf8'), label, isAI: false });
        res.redirect('/stats');
    } catch (e) { res.status(500).send(e.message); }
});

app.post("/save-edit", async (req, res) => {
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { 
        arabicText: req.body.newText, 
        isAI: req.body.newText.length > 500 
    });
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
app.listen(process.env.PORT || 10000);

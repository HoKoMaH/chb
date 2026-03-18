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

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] Connected"))
    .catch(err => console.error("❌ [DATABASE] Error:", err));

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
 * مسار التعريب المباشر مع دعم النسبة المئوية
 */
app.post("/instant-translate", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const sendLog = (msg) => res.write(`data: ${msg}\n\n`);

    try {
        sendLog("🚀 بدء عملية التعريب الشامل...");
        
        // استدعاء السكرابر مع وظيفة تحديث النسبة المئوية
        const translated = await translateToArabic(req.body.text, (percent) => {
            sendLog(`⏳ جاري المعالجة: ${percent}%`);
        });

        if (translated) {
            sendLog("✅ اكتملت الترجمة بنجاح 100%");
            res.write(`data: [RESULT]${translated}\n\n`);
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
 * واجهة التعديل مع شريط التقدم والنسبة المئوية
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    res.send(`
    <html dir="rtl"><head><meta charset="UTF-8"><title>محرر الترجمة</title>
    <style>
        body { font-family:sans-serif; padding:20px; background:#f4f7f6; }
        .box { max-width:1000px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1); }
        textarea { width:100%; height:55vh; padding:15px; border-radius:10px; font-family:monospace; border:1px solid #ddd; }
        .log-win { background:#1e1e1e; color:#00ff00; padding:15px; border-radius:8px; font-family:monospace; font-size:13px; max-height:120px; overflow-y:auto; margin-bottom:15px; display:none; }
        .progress-container { width:100%; background:#eee; height:8px; border-radius:10px; margin-bottom:10px; display:none; overflow:hidden; }
        .progress-bar { width:0%; height:100%; background:#2ecc71; transition:width 0.3s; }
        .btn { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight:bold; color:white; }
    </style></head>
    <body>
        <div class="box">
            <h2>🛠️ محرر الترجمة: ${sub.label}</h2>
            <div id="pCont" class="progress-container"><div id="pBar" class="progress-bar"></div></div>
            <div id="logWin" class="log-win"></div>
            <div style="background:#f8f9fa; padding:15px; border-radius:10px; margin-bottom:15px; display:flex; gap:10px; align-items:center;">
                <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">🤖 تعريب يدوي (فارسي/أجنبي)</button>
                <span id="status" style="font-weight:bold; color:#27ae60;"></span>
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
            function addLog(m) { const w = document.getElementById('logWin'); w.style.display='block'; w.innerHTML+='<div>'+m+'</div>'; w.scrollTop=w.scrollHeight; }
            async function startInstantTranslate() {
                const logW = document.getElementById('logWin'); logW.innerHTML=''; 
                document.getElementById('pCont').style.display='block';
                const response = await fetch('/instant-translate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value }) });
                const reader = response.body.getReader(); const decoder = new TextDecoder();
                while (true) {
                    const { value, done } = await reader.read(); if (done) break;
                    const chunk = decoder.decode(value); const lines = chunk.split('\\n\\n');
                    for (let line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.replace('data: ', '');
                            if (data.startsWith('[RESULT]')) { 
                                document.getElementById('txt').value = data.replace('[RESULT]', ''); 
                                document.getElementById('pBar').style.width = '100%';
                                document.getElementById('status').innerText = '✅ اكتمل 100%';
                            } else if (data.includes('%')) {
                                const p = data.match(/\\d+/)[0];
                                document.getElementById('pBar').style.width = p + '%';
                                document.getElementById('status').innerText = '⏳ ' + p + '%';
                                addLog(data);
                            } else addLog(data);
                        }
                    }
                }
            }
        </script>
    </body></html>`);
});

// باقي المسارات (Stats, Save, Delete)
app.get("/stats", async (req, res) => {
    const totalSubs = await Subtitle.countDocuments();
    const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
    let rows = latestSubs.map(sub => `<tr><td>${sub.label}</td><td>${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}</td><td><a href="/edit/${sub.fileId}">تعديل</a></td></tr>`).join('');
    res.send(`<html dir="rtl"><body><h1>لوحة التحكم (${totalSubs})</h1><table border="1" style="width:100%">${rows}</table></body></html>`);
});

app.post("/save-edit", async (req, res) => {
    const hasArFa = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(req.body.newText);
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { arabicText: req.body.newText, isAI: hasArFa && req.body.newText.length > 100 });
    res.send("<script>alert('تم الحفظ!'); window.location.href='/stats';</script>");
});

app.get("/sub/:fileId.srt", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId.replace('.srt', '') });
    if (sub) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Access-Control-Allow-Origin', '*'); res.send(sub.arabicText); }
    else res.status(404).send("Not found");
});

app.use("/", getRouter(addonInterface));
app.listen(process.env.PORT || 10000);

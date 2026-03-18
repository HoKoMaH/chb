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
 * 1. إعدادات استقبال البيانات
 */
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * 2. الاتصال بقاعدة البيانات
 */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] Connected"))
    .catch(err => console.error("❌ [DATABASE] Error:", err));

/**
 * 3. تعريف الموديل
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
 * 5. مسار التعريب المباشر مع اللوجات (Streaming) لدعم الفارسية/العربية
 */
app.post("/instant-translate", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const sendLog = (msg) => res.write(`data: ${msg}\n\n`);

    try {
        sendLog("🚀 بدء عملية التعريب اليدوي...");
        if (!req.body.text || req.body.text.length < 10) throw new Error("النص قصير جداً.");
        
        sendLog("⏳ جاري تحليل ملف SRT واكتشاف اللغة...");
        sendLog("🌐 استدعاء محرك الترجمة الذكي...");
        
        const translated = await translateToArabic(req.body.text);

        if (translated && translated.length > 10) {
            sendLog("✅ تمت عملية الترجمة بنجاح (فارسي/أجنبي -> عربي)!");
            res.write(`data: [RESULT]${translated}\n\n`);
        } else {
            throw new Error("فشل التعريب: المحرك لم يرجع بيانات.");
        }
    } catch (e) {
        sendLog(`❌ خطأ: ${e.message}`);
    } finally {
        res.end();
    }
});

/**
 * 6. واجهة التعديل (Edit)
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
        .log-win { background:#1e1e1e; color:#00ff00; padding:15px; border-radius:8px; font-family:monospace; font-size:13px; max-height:120px; overflow-y:auto; margin-bottom:15px; display:none; border-right:5px solid #8e44ad; }
        .btn { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight:bold; color:white; }
    </style></head>
    <body>
        <div class="box">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h2 style="margin:0;">🛠️ محرر الترجمة: ${sub.label}</h2>
                <button onclick="downloadSrt()" class="btn" style="background:#34495e;">📥 تحميل SRT</button>
            </div>
            <div id="logWin" class="log-win"></div>
            <div style="background:#f8f9fa; padding:15px; border-radius:10px; margin-bottom:15px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">🤖 تعريب يدوي (فارسي/أجنبي)</button>
                <b style="margin-right:20px;">⏱️ مزامنة:</b>
                <button onclick="shiftSync(-0.5)" class="btn" style="background:#e67e22;">-0.5s</button>
                <button onclick="shiftSync(0.5)" class="btn" style="background:#3498db;">+0.5s</button>
                <span id="status" style="color:#27ae60; font-weight:bold;"></span>
            </div>
            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText">${sub.arabicText}</textarea>
                <div style="text-align:center; margin-top:20px;">
                    <button type="submit" class="btn" style="background:#2ecc71; padding:15px 50px;">حفظ التغييرات ✅</button>
                    <a href="/stats" style="margin-right:20px; color:#666; text-decoration:none;">إلغاء</a>
                </div>
            </form>
        </div>
        <script>
            function addLog(m) { const w = document.getElementById('logWin'); w.style.display='block'; w.innerHTML+='<div>'+m+'</div>'; w.scrollTop=w.scrollHeight; }
            async function startInstantTranslate() {
                const logW = document.getElementById('logWin'); logW.innerHTML=''; addLog('📡 جارِ الاتصال بالسيرفر...');
                const response = await fetch('/instant-translate', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value }) });
                const reader = response.body.getReader(); const decoder = new TextDecoder();
                while (true) {
                    const { value, done } = await reader.read(); if (done) break;
                    const chunk = decoder.decode(value); const lines = chunk.split('\\n\\n');
                    for (let line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.replace('data: ', '');
                            if (data.startsWith('[RESULT]')) { document.getElementById('txt').value = data.replace('[RESULT]', ''); document.getElementById('status').innerText = '✅ اكتمل!'; }
                            else addLog(data);
                        }
                    }
                }
            }
            // دالة المزامنة والتحميل تبقى كما هي...
            async function shiftSync(o) {
                const r = await fetch('/adjust-sync', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value, offset:o }) });
                const res = await r.text(); if(res) { document.getElementById('txt').value = res; document.getElementById('status').innerText = '✅ تم المزامنة'; }
            }
            function downloadSrt() { const b = new Blob([document.getElementById('txt').value], { type: 'text/plain' }); const a = document.createElement('a'); a.download = "${sub.label}.srt"; a.href = window.URL.createObjectURL(b); a.click(); }
        </script>
    </body></html>`);
});

/**
 * 7. لوحة التحكم (Stats) - الواجهة المفتوحة
 */
app.get("/stats", async (req, res) => {
    try {
        const totalSubs = await Subtitle.countDocuments();
        const aiSubs = await Subtitle.countDocuments({ isAI: true });
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
        const installUrl = `stremio://${process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com"}/manifest.json`;
        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 12px;">${sub.label}</td><td style="text-align: center;">${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}</td><td style="text-align: center;"><a href="/edit/${sub.fileId}" style="text-decoration:none; background:#3498db; color:white; padding:5px 10px; border-radius:5px;">تعديل</a> <a href="/delete/${sub.fileId}" onclick="return confirm('حذف؟')" style="text-decoration:none; background:#e74c3c; color:white; padding:5px 10px; border-radius:5px;">حذف</a></td></tr>`).join('');
        res.send(`<html dir="rtl"><head><meta charset="UTF-8"><title>لوحة التحكم</title><style>body{font-family:sans-serif;background:#f4f7f6;padding:20px;}.card{background:white;padding:20px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.05);margin-bottom:20px;}input,select,button{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:1px solid #ddd;}.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:20px;}.search-item{padding:8px;border-bottom:1px solid #f0f0f0;cursor:pointer;}</style></head><body><div style="max-width:900px;margin:auto;text-align:center;"><h1>📊 إدارة ترجمات AR.SA</h1><a href="${installUrl}" style="background:#8e44ad;color:white;padding:12px 25px;border-radius:50px;text-decoration:none;font-weight:bold;display:inline-block;margin-bottom:20px;">+ تثبيت الإضافة</a><div class="grid-2"><div class="card"><h3>🔍 بحث IMDb</h3><input id="q" placeholder="اسم الفيلم..." oninput="autoSearch()"><div id="r" style="text-align:right;max-height:150px;overflow:auto;"></div></div><div class="card"><h3>📤 رفع ملف</h3><form action="/upload-manual" method="POST" enctype="multipart/form-data"><select name="type" id="type" onchange="toggleF()"><option value="movie">🎬 فيلم</option><option value="series">📺 مسلسل</option></select><input name="imdbId" id="manual_id" placeholder="IMDb ID" required><div id="sF" style="display:none;gap:5px;"><input type="number" name="season" placeholder="موسم" style="width:50%"><input type="number" name="episode" placeholder="حلقة" style="width:50%"></div><input name="label" id="manual_label" placeholder="اسم النسخة" required><input type="file" name="subtitleFile" accept=".srt" required onchange="updateL(this)"><button type="submit" style="background:#27ae60;color:white;">حفظ</button></form></div></div><div class="card"><table style="width:100%;text-align:right;"><thead><tr style="background:#f8f9fa;"><th>المحتوى</th><th>المصدر</th><th>الإجراء</th></tr></thead><tbody>${rows}</tbody></table></div></div><script>function toggleF(){document.getElementById('sF').style.display=document.getElementById('type').value==='series'?'flex':'none';}function updateL(i){if(i.files[0])document.getElementById('manual_label').value=i.files[0].name.replace('.srt','');}let t;function autoSearch(){clearTimeout(t);const q=document.getElementById('q').value;if(!q)return;t=setTimeout(async()=>{const r=await fetch('/search-id?q='+q);const d=await r.json();document.getElementById('r').innerHTML=d.slice(0,6).map(i=>\`<div class="search-item" onclick="copyI('\${i.id}',\${i.q==='TV series'},event)">\${i.l} - \${i.id}</div>\`).join('');},500);}function copyI(id,isS,e){document.getElementById('manual_id').value=id;document.getElementById('type').value=isS?'series':'movie';toggleF();document.querySelectorAll('.search-item').forEach(x=>x.style.background='white');e.currentTarget.style.background='#e8f4fd';}</script></body></html>`);
    } catch (e) { res.status(500).send("Error"); }
});

// المسارات الخلفية الإضافية (حفظ، حذف، مزامنة)
app.post("/save-edit", async (req, res) => {
    // تحديث Regex ليشمل العربية والفارسية
    const hasArFa = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(req.body.newText);
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { 
        arabicText: req.body.newText, 
        isAI: hasArFa && req.body.newText.length > 100 
    });
    res.send("<script>alert('تم الحفظ!'); window.location.href='/stats';</script>");
});

app.get("/delete/:fileId", async (req, res) => { await Subtitle.deleteOne({ fileId: req.params.fileId }); res.redirect('/stats'); });
app.get("/delete-all-now", async (req, res) => { await Subtitle.deleteMany({}); res.redirect('/stats'); });

app.get("/sub/:fileId.srt", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId.replace('.srt', '') });
    if (sub) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Access-Control-Allow-Origin', '*'); res.send(sub.arabicText); }
    else res.status(404).send("Not found");
});

app.use("/", getRouter(addonInterface));
app.listen(process.env.PORT || 10000);

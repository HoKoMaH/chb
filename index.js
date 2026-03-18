const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); 
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

// --- حل مشكلة Payload Too Large (رفع الحد لـ 50 ميجابايت) ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Database Connected"))
    .catch(err => console.error("❌ DB Error:", err));

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

// محرك بحث IMDb سريع
app.get("/search-id", async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    try {
        const response = await axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`);
        res.json(response.data.d || []);
    } catch (e) { res.status(500).json([]); }
});

// واجهة التعديل والتعريب الفوري
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    
    res.send(`
    <html dir="rtl"><body style="font-family:sans-serif; padding:20px; background:#f4f7f6;">
        <div style="max-width:900px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
            <h2>تعديل: ${sub.label}</h2>
            <button onclick="instantTranslate()" style="background:#8e44ad; color:white; padding:10px; border:none; border-radius:8px; cursor:pointer;">🤖 تعريب فوري</button>
            <span id="status"></span>
            <form action="/save-edit" method="POST" style="margin-top:10px;">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText" style="width:100%; height:65vh; padding:10px; font-family:monospace;">${sub.arabicText}</textarea>
                <div style="text-align:center; margin-top:15px;">
                    <button type="submit" style="background:#27ae60; color:white; padding:12px 40px; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">حفظ التعديلات ✅</button>
                    <a href="/stats" style="margin-right:20px; color:#666;">إلغاء</a>
                </div>
            </form>
        </div>
        <script>
            async function instantTranslate() {
                const text = document.getElementById('txt').value;
                if(!confirm('بدء التعريب؟')) return;
                document.getElementById('status').innerText = '⏳ جاري العمل.. تابع اللوقات';
                const res = await fetch('/instant-translate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ text })
                });
                const result = await res.text();
                if(result) { document.getElementById('txt').value = result; document.getElementById('status').innerText = '✅ اكتمل'; }
            }
        </script>
    </body></html>`);
});

app.post("/instant-translate", async (req, res) => {
    const translated = await translateToArabic(req.body.text);
    res.send(translated || "");
});

app.post("/save-edit", async (req, res) => {
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { arabicText: req.body.newText });
    res.send("<script>alert('تم الحفظ!'); window.location.href='/stats';</script>");
});

app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    const { imdbId, label } = req.body;
    const fileId = `${imdbId.replace(/:/g, '_')}_manual_${Date.now()}`;
    await Subtitle.findOneAndUpdate({ fileId }, {
        imdbId: imdbId.trim(),
        arabicText: req.file.buffer.toString('utf8'),
        label: label || req.file.originalname,
        isAI: false
    }, { upsert: true });
    res.redirect('/stats');
});

app.get("/stats", async (req, res) => {
    const total = await Subtitle.countDocuments();
    const subs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
    let rows = subs.map(s => `<tr><td style="padding:8px; border-bottom:1px solid #eee;">${s.label}</td><td style="text-align:center;"><a href="/edit/${s.fileId}">تعديل 📝</a> | <a href="/delete/${s.fileId}" style="color:red;">حذف</a></td></tr>`).join('');
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; padding:20px;"><div style="max-width:800px; margin:auto;">
        <h1>📊 إحصائيات AR.SA</h1>
        <div style="background:#eee; padding:15px; border-radius:10px; margin-bottom:20px;">
            <h3>🔍 بحث IMDb ID</h3>
            <input id="q" style="width:70%; padding:8px;"><button onclick="s()">بحث</button><div id="r"></div>
        </div>
        <div style="background:#f9f9f9; padding:15px; border-radius:10px; margin-bottom:20px;">
            <h3>📤 رفع يدوي</h3>
            <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                <input name="imdbId" placeholder="ID" required> <input name="label" placeholder="الاسم" required>
                <input type="file" name="subtitleFile" accept=".srt" required> <button type="submit">رفع</button>
            </form>
        </div>
        <table style="width:100%; border-collapse:collapse;">${rows}</table>
        <script>async function s(){ const res=await fetch('/search-id?q='+document.getElementById('q').value); const d=await res.json(); document.getElementById('r').innerHTML = d.slice(0,5).map(i=>'<li>'+i.l+': <code>'+i.id+'</code></li>').join(''); }</script>
    </div></body></html>`);
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

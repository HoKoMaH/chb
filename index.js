const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); 
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

// 1. إعداد عميل Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * 2. محرك بحث IMDb ID
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
 * 3. مسار التعريب المباشر (Streaming Response)
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
            res.write("data: [RESULT]" + JSON.stringify({ result: translated }) + "\n\n");
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
 * 4. واجهة التعديل (Edit Page)
 */
app.get("/edit/:fileId", async (req, res) => {
    try {
        const { data: sub, error } = await supabase
            .from('subtitles')
            .select('*')
            .eq('file_id', req.params.fileId)
            .single();

        if (!sub) return res.send("الملف غير موجود");

        res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>محرر AR.SA</title>
        <style>
            body { font-family:sans-serif; padding:20px; background:#f4f7f6; }
            .box { max-width:1000px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1); }
            textarea { width:100%; height:55vh; padding:15px; border-radius:10px; font-family:monospace; border:1px solid #ddd; }
            .btn { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight:bold; color:white; transition:0.3s; }
        </style></head>
        <body>
            <div class="box">
                <h2>🛠️ محرر الترجمة: \${sub.label}</h2>
                <div style="background:#f8f9fa; padding:15px; border-radius:10px; margin-bottom:15px; display:flex; gap:10px;">
                    <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">🤖 تعريب تلقائي</button>
                </div>
                <form action="/save-edit" method="POST">
                    <input type="hidden" name="fileId" value="\${sub.file_id}">
                    <textarea id="txt" name="newText">\${sub.arabic_text}</textarea>
                    <div style="text-align:center; margin-top:20px;">
                        <button type="submit" class="btn" style="background:#2ecc71; padding:15px 50px;">حفظ التغييرات ✅</button>
                    </div>
                </form>
            </div>
            <script>
                async function startInstantTranslate() {
                    if(!confirm('ابدأ التعريب؟')) return;
                    const response = await fetch('/instant-translate', { 
                        method: 'POST', 
                        headers: {'Content-Type': 'application/json'}, 
                        body: JSON.stringify({ text: document.getElementById('txt').value }) 
                    });
                    const reader = response.body.getReader(); const decoder = new TextDecoder();
                    while (true) {
                        const { value, done } = await reader.read(); if (done) break;
                        const chunk = decoder.decode(value);
                        if (chunk.includes('[RESULT]')) {
                            const cleanJson = chunk.split('[RESULT]')[1].split('\\n\\n')[0];
                            document.getElementById('txt').value = JSON.parse(cleanJson).result;
                        }
                    }
                }
            </script>
        </body></html>`);
    } catch (e) { res.status(500).send("Server Error"); }
});

/**
 * 5. لوحة التحكم (Stats Page)
 */
app.get("/stats", async (req, res) => {
    try {
        const { data: latestSubs } = await supabase
            .from('subtitles')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(40);

        const installUrl = "stremio://" + (process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com") + "/manifest.json";

        let rows = (latestSubs || []).map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px;">\${sub.label}</td>
                <td style="padding: 12px; text-align: center;">\${sub.is_ai ? '🤖' : '🇸🇦'}</td>
                <td style="padding: 12px; text-align: center;">
                    <a href="/edit/\${sub.file_id}" style="text-decoration:none; color:#3498db;">تعديل</a> | 
                    <a href="/delete/\${sub.file_id}" style="text-decoration:none; color:#e74c3c;">حذف</a>
                </td>
            </tr>`).join('');

        res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>إدارة AR.SA</title>
        <style>body{font-family:sans-serif; background:#f4f7f6; padding:20px;}.card{background:white; padding:20px; border-radius:12px; margin-bottom:20px;}</style></head>
        <body>
            <div style="max-width: 900px; margin: auto;">
                <h1 style="text-align:center;">📊 لوحة تحكم AR.SA</h1>
                <div class="card">
                    <h3>📤 رفع يدوي</h3>
                    <form action="/upload-manual" method="POST" enctype="multipart/form-data" style="display:flex; gap:10px;">
                        <input name="imdbId" placeholder="tt..." required>
                        <input name="label" placeholder="اسم النسخة" required style="flex:1;">
                        <input type="file" name="subtitleFile" accept=".srt" required>
                        <button type="submit" style="background:#27ae60; color:white; border:none; padding:8px 20px; cursor:pointer;">حفظ</button>
                    </form>
                </div>
                <div class="card">
                    <table style="width:100%; text-align:right;">
                        <thead><tr style="background:#f8f9fa;"><th>المحتوى</th><th>النوع</th><th>الإجراء</th></tr></thead>
                        <tbody>\${rows}</tbody>
                    </table>
                </div>
            </div>
        </body></html>`);
    } catch (e) { res.status(500).send("Error loading stats"); }
});

/**
 * 6. مسارات CRUD
 */
app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    const { imdbId, label } = req.body;
    const dbFileId = imdbId.replace(/:/g, '_') + "_manual_" + Date.now();
    await supabase.from('subtitles').insert([
        { file_id: dbFileId, imdb_id: imdbId, arabic_text: req.file.buffer.toString('utf8'), label, is_ai: false }
    ]);
    res.redirect('/stats');
});

app.post("/save-edit", async (req, res) => {
    await supabase.from('subtitles')
        .update({ arabic_text: req.body.newText, is_ai: req.body.newText.length > 500 })
        .eq('file_id', req.body.fileId);
    res.redirect('/stats');
});

app.get("/delete/:fileId", async (req, res) => { 
    await supabase.from('subtitles').delete().eq('file_id', req.params.fileId);
    res.redirect('/stats'); 
});

app.get("/sub/:fileId.srt", async (req, res) => {
    const { data: sub } = await supabase
        .from('subtitles')
        .select('arabic_text')
        .eq('file_id', req.params.fileId.replace('.srt', ''))
        .single();

    if (sub) { 
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); 
        res.setHeader('Access-Control-Allow-Origin', '*'); 
        res.send(sub.arabic_text); 
    } else res.status(404).send("Not found");
});

app.use("/", getRouter(addonInterface));
app.listen(process.env.PORT || 10000);

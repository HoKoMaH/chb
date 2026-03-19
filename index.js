const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); 
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

// 1. إعداد عميل Supabase (بديل Mongoose)
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
        const response = await axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`);
        res.json(response.data.d || []);
    } catch (e) { res.status(500).json([]); }
});

/**
 * 3. مسار التعريب المباشر (SSE)
 */
app.post("/instant-translate", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); 

    const sendLog = (msg) => {
        res.write(`data: ${msg.replace(/\n/g, ' ')}\n\n`);
    };

    try {
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
 * 4. واجهة التعديل (Edit Page)
 */
app.get("/edit/:fileId", async (req, res) => {
    const { data: sub } = await supabase.from('subtitles').select('*').eq('file_id', req.params.fileId).single();
    if (!sub) return res.send("الملف غير موجود");

    res.send(`
    <html dir="rtl"><head><meta charset="UTF-8"><title>محرر | AR.SA</title>
    <style>
        body { font-family:sans-serif; padding:20px; background:#f4f7f6; color:#333; }
        .box { max-width:1000px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1); }
        textarea { width:100%; height:55vh; padding:15px; border-radius:10px; font-family:monospace; border:1px solid #ddd; font-size:14px; }
        .log-win { background:#1e1e1e; color:#00ff00; padding:15px; border-radius:8px; font-family:monospace; font-size:13px; max-height:120px; overflow-y:auto; margin-bottom:15px; display:none; border-right:5px solid #8e44ad; }
        .progress-container { width: 100%; background: #eee; height: 10px; border-radius: 10px; margin-bottom: 15px; display: none; overflow: hidden; }
        .progress-bar { width: 0%; height: 100%; background: #2ecc71; transition: width 0.4s ease; }
        .btn { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight:bold; color:white; transition:0.3s; }
    </style></head>
    <body>
        <div class="box">
            <h2>🛠️ محرر الترجمة: \${sub.label}</h2>
            <div id="pCont" class="progress-container"><div id="pBar" class="progress-bar"></div></div>
            <div id="logWin" class="log-win"></div>
            <div style="background:#f8f9fa; padding:15px; border-radius:10px; margin-bottom:15px; display:flex; gap:10px; align-items:center;">
                <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">🤖 ابدأ التعريب الذكي</button>
                <span id="status" style="color:#27ae60; font-weight:bold;"></span>
            </div>
            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="\${sub.file_id}">
                <textarea id="txt" name="newText">\${sub.arabic_text}</textarea>
                <div style="text-align:center; margin-top:20px;">
                    <button type="submit" class="btn" style="background:#2ecc71; padding:15px 50px;">حفظ التغييرات ✅</button>
                    <a href="/stats" style="margin-right:20px; color:#666; text-decoration:none;">إلغاء</a>
                </div>
            </form>
        </div>
        <script>
            async function startInstantTranslate() {
                if(!confirm('ابدأ التعريب؟')) return;
                const logW = document.getElementById('logWin'); logW.innerHTML=''; logW.style.display='block';
                const pCont = document.getElementById('pCont'); pCont.style.display='block';
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
                        const parsed = JSON.parse(chunk.split('[RESULT]')[1].split('\\n\\n')[0]);
                        document.getElementById('txt').value = parsed.result;
                        document.getElementById('status').innerText = '✅ اكتمل!';
                    } else if (chunk.includes('%')) {
                        const p = chunk.match(/\\d+/)[0];
                        document.getElementById('pBar').style.width = p + '%';
                        logW.innerHTML += '<div>' + chunk + '</div>';
                    }
                }
            }
        </script>
    </body></html>`);
});

/**
 * 5. لوحة التحكم (Stats Page)
 */
app.get("/stats", async (req, res) => {
    try {
        const { data: allData } = await supabase.from('subtitles').select('*').order('created_at', { ascending: false });
        const total = allData ? allData.length : 0;
        const aiCount = allData ? allData.filter(s => s.is_ai).length : 0;
        const installUrl = \`stremio://\${process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com"}/manifest.json\`;

        let rows = (allData || []).slice(0, 40).map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px;">\${sub.label} <br> <small>\${sub.imdb_id}</small></td>
                <td style="text-align:center;">\${sub.is_ai ? '🤖 AI' : '🇸🇦 أصلية'}</td>
                <td style="text-align:center;">
                    <a href="/edit/\${sub.file_id}" style="background:#3498db; color:white; padding:5px 10px; border-radius:5px; text-decoration:none;">تعديل</a>
                    <a href="/delete/\${sub.file_id}" style="background:#e74c3c; color:white; padding:5px 10px; border-radius:5px; text-decoration:none;">حذف</a>
                </td>
            </tr>`).join('');

        res.send(\`
        <html dir="rtl"><head><meta charset="UTF-8"><title>إدارة AR.SA</title>
        <style>
            body { font-family:sans-serif; background:#f4f7f6; padding:20px; }
            .card { background:white; padding:20px; border-radius:12px; margin-bottom:20px; box-shadow:0 2px 10px rgba(0,0,0,0.05); }
            .grid { display:grid; grid-template-columns: 1fr 1fr; gap:20px; }
            input, select, button { width:100%; padding:10px; margin:5px 0; border-radius:8px; border:1px solid #ddd; }
        </style></head>
        <body>
            <div style="max-width:900px; margin:auto;">
                <h1 style="text-align:center;">📊 لوحة تحكم AR.SA</h1>
                <div style="display:flex; gap:15px; margin-bottom:20px;">
                    <div class="card" style="flex:1; text-align:center;"><h3>إجمالي</h3><p>\${total}</p></div>
                    <div class="card" style="flex:1; text-align:center;"><h3>🤖 AI</h3><p>\${aiCount}</p></div>
                </div>
                <div class="grid">
                    <div class="card">
                        <h3>🔍 بحث IMDb</h3>
                        <input id="q" placeholder="اسم الفيلم..." oninput="autoSearch()">
                        <div id="r" style="max-height:150px; overflow:auto; border:1px solid #eee; margin-top:5px;"></div>
                    </div>
                    <div class="card">
                        <h3>📤 رفع يدوي</h3>
                        <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                            <input name="imdbId" id="manual_id" placeholder="tt..." required>
                            <input name="label" id="manual_label" placeholder="الاسم" required>
                            <input type="file" name="subtitleFile" accept=".srt" required>
                            <button type="submit" style="background:#27ae60; color:white; border:none;">حفظ</button>
                        </form>
                    </div>
                </div>
                <div class="card">
                    <table style="width:100%; text-align:right;">
                        <thead><tr style="background:#f8f9fa;"><th>المحتوى</th><th>النوع</th><th>الإجراء</th></tr></thead>
                        <tbody>\${rows}</tbody>
                    </table>
                </div>
            </div>
            <script>
                function autoSearch() {
                    const q = document.getElementById('q').value;
                    if(q.length < 3) return;
                    fetch('/search-id?q=' + q).then(res => res.json()).then(data => {
                        document.getElementById('r').innerHTML = data.map(i => \`<div style="padding:5px; cursor:pointer;" onclick="document.getElementById('manual_id').value='\${i.id}'">\${i.l}</div>\`).join('');
                    });
                }
            </script>
        </body></html>\`);
    } catch (e) { res.status(500).send("Error"); }
});

/**
 * 6. المسارات الخلفية
 */
app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    const { imdbId, label } = req.body;
    const dbFileId = \`\${imdbId.replace(/:/g, '_')}_manual_\${Date.now()}\`;
    await supabase.from('subtitles').insert([{ 
        file_id: dbFileId, 
        imdb_id: imdbId, 
        arabic_text: req.file.buffer.toString('utf8'), 
        label, 
        is_ai: false 
    }]);
    res.redirect('/stats');
});

app.post("/save-edit", async (req, res) => {
    await supabase.from('subtitles').update({ 
        arabic_text: req.body.newText, 
        is_ai: req.body.newText.length > 500 
    }).eq('file_id', req.body.fileId);
    res.redirect('/stats');
});

app.get("/delete/:fileId", async (req, res) => { 
    await supabase.from('subtitles').delete().eq('file_id', req.params.fileId);
    res.redirect('/stats'); 
});

app.get("/sub/:fileId.srt", async (req, res) => {
    const { data: sub } = await supabase.from('subtitles').select('arabic_text').eq('file_id', req.params.fileId.replace('.srt', '')).single();
    if (sub) { 
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); 
        res.setHeader('Access-Control-Allow-Origin', '*'); 
        res.send(sub.arabic_text); 
    } else res.status(404).send("Not found");
});

app.use("/", getRouter(addonInterface));
app.listen(process.env.PORT || 10000);

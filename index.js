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
 * 5. مسار التعريب المباشر (إصدار البث الآمن للملفات الضخمة)
 */
app.post("/instant-translate", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // هامة لمنع التقطيع في Render

    const sendLog = (msg) => {
        const cleanMsg = msg.replace(/\n/g, ' ');
        res.write(`data: ${cleanMsg}\n\n`);
    };

    try {
        sendLog("🚀 بدء عملية التعريب الشامل عبر محرك البحث السريع...");
        if (!req.body.text || req.body.text.length < 10) throw new Error("النص قصير جداً.");
        
        // استدعاء المترجم مع تمرير دالة النسبة المئوية
        const translated = await translateToArabic(req.body.text, (percent) => {
            sendLog(`⏳ جاري المعالجة: ${percent}%`);
        });

        if (translated && translated.length > 10) {
            sendLog("✅ تمت عملية الترجمة بنجاح 100%");
            // نغلف النتيجة بـ JSON لضمان وصولها كاملة دون تأثر ببروتوكول SSE
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
 * 7. واجهة التعديل (Edit Page) مع سكريبت استقبال البيانات المطور
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
        .btn:hover { opacity:0.8; }
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
                <button onclick="startInstantTranslate()" class="btn" style="background:#8e44ad;">ابدأ التعريب اليدوي (لوج حي)</button>
                <b style="margin-right:20px;">⏱️ مزامنة:</b>
                <button onclick="shiftSync(-0.5)" class="btn" style="background:#e67e22;">-0.5s</button>
                <button onclick="shiftSync(0.5)" class="btn" style="background:#3498db;">+0.5s</button>
                <span id="status" style="color:#27ae60; font-weight:bold; margin-right:10px;"></span>
            </div>

            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText">${sub.arabicText}</textarea>
                <div style="text-align:center; margin-top:20px;">
                    <button type="submit" class="btn" style="background:#2ecc71; padding:15px 50px; font-size:16px;">حفظ التغييرات ✅</button>
                    <a href="/stats" style="margin-right:20px; color:#666; text-decoration:none;">إلغاء والعودة</a>
                </div>
            </form>
        </div>
        <script>
            function addLog(m) { const w = document.getElementById('logWin'); w.style.display='block'; w.innerHTML+='<div>'+m+'</div>'; w.scrollTop=w.scrollHeight; }
            
            async function startInstantTranslate() {
                if(!confirm('هل تريد تعريب هذا الملف يدوياً؟')) return;
                const logW = document.getElementById('logWin'); logW.innerHTML=''; 
                const pCont = document.getElementById('pCont'); pCont.style.display='block';
                const pBar = document.getElementById('pBar'); pBar.style.width = '0%';
                addLog('📡 جارِ الاتصال بالسيرفر لبدء التعريب...');
                
                const response = await fetch('/instant-translate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ text: document.getElementById('txt').value })
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let accumulatedData = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    
                    accumulatedData += decoder.decode(value);
                    const chunks = accumulatedData.split('\\n\\n');
                    
                    // الاحتفاظ بآخر قطعة غير مكتملة
                    accumulatedData = chunks.pop();

                    for (let chunk of chunks) {
                        if (chunk.startsWith('data: ')) {
                            const data = chunk.replace('data: ', '');
                            
                            if (data.startsWith('[RESULT]')) {
                                try {
                                    const jsonContent = data.replace('[RESULT]', '');
                                    const parsed = JSON.parse(jsonContent);
                                    document.getElementById('txt').value = parsed.result;
                                    document.getElementById('status').innerText = '✅ اكتمل التعريب!';
                                    pBar.style.width = '100%';
                                } catch(e) { console.error("Parse error", e); }
                            } else if (data.includes('%')) {
                                const percentMatch = data.match(/\\d+/);
                                if(percentMatch) {
                                    const percent = percentMatch[0];
                                    pBar.style.width = percent + '%';
                                    document.getElementById('status').innerText = '⏳ جاري المعالجة: ' + percent + '%';
                                    addLog(data);
                                }
                            } else {
                                addLog(data);
                            }
                        }
                    }
                }
            }

            async function shiftSync(offset) {
                const res = await fetch('/adjust-sync', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value, offset }) });
                const result = await res.text();
                if(result) { document.getElementById('txt').value = result; document.getElementById('status').innerText = '✅ تم المزامنة'; }
            }

            function downloadSrt() {
                const blob = new Blob([document.getElementById('txt').value], { type: 'text/plain' });
                const a = document.createElement('a'); a.download = "${sub.label.replace(/'/g, '')}.srt"; a.href = window.URL.createObjectURL(blob); a.click();
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
        const aiSubs = await Subtitle.countDocuments({ isAI: true });
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
        const installUrl = `stremio://${process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com"}/manifest.json`;

        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-size: 13px;">${sub.label} <br> <small style="color:#888;">ID: ${sub.imdbId}</small></td>
                <td style="padding: 12px; text-align: center;">${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}</td>
                <td style="padding: 12px; text-align: center;">
                    <a href="/edit/${sub.fileId}" style="text-decoration:none; background:#3498db; color:white; padding:5px 10px; border-radius:5px; font-size:12px;">تعديل/تعريب</a>
                    <a href="/delete/${sub.fileId}" onclick="return confirm('حذف؟')" style="text-decoration:none; background:#e74c3c; color:white; padding:5px 10px; border-radius:5px; font-size:12px;">حذف</a>
                </td>
            </tr>`).join('');

        res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>إدارة ترجمات Stremio</title>
        <style>
            body { font-family: sans-serif; background: #f4f7f6; padding: 20px; }
            .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 20px; }
            input, select, button { width: 100%; padding: 10px; margin: 5px 0; border-radius: 8px; border: 1px solid #ddd; box-sizing: border-box; }
            .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; }
            .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            .search-item { padding: 8px; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: 0.2s; }
            .search-item:hover { background: #e8f4fd; }
            .danger-btn { background:#c0392b; color:white; border:none; padding:10px; border-radius:8px; cursor:pointer; font-weight:bold; }
        </style></head>
        <body>
            <div style="max-width: 900px; margin: auto; text-align:center;">
                <h1>📊 إدارة ترجمات Stremio</h1>
                <a href="${installUrl}" style="background:#8e44ad; color:white; padding:12px 25px; border-radius:50px; text-decoration:none; font-weight:bold; display:inline-block; margin-bottom:20px;">+ تثبيت الإضافة في Stremio</a>
                
                <div class="stats-grid">
                    <div class="card" style="border-top:4px solid #3498db;"><h3>الإجمالي</h3><p>${totalSubs}</p></div>
                    <div class="card" style="border-top:4px solid #2ecc71;"><h3>🤖 AI</h3><p>${aiSubs}</p></div>
                    <div class="card" style="border-top:4px solid #f1c40f;"><h3>أصلي</h3><p>${totalSubs - aiSubs}</p></div>
                </div>

                <div class="grid-2">
                    <div class="card">
                        <h3>🔍 البحث عن محتوى (تلقائي)</h3>
                        <input id="q" placeholder="ابدأ بكتابة اسم الفيلم..." oninput="autoSearch()">
                        <div id="r" style="text-align:right; font-size:12px; margin-top:10px; border:1px solid #eee; border-radius:8px; max-height:180px; overflow:auto;"></div>
                    </div>
                    <div class="card">
                        <h3>📤 رفع ملف يدوي</h3>
                        <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                            <select name="type" id="type" onchange="toggleFields()">
                                <option value="movie">🎬 فيلم</option>
                                <option value="series">📺 مسلسل</option>
                            </select>
                            <input name="imdbId" id="manual_id" placeholder="IMDb ID (tt...)" required>
                            <div id="sFields" style="display:none; gap:5px;">
                                <input type="number" name="season" placeholder="موسم" style="width:50%">
                                <input type="number" name="episode" placeholder="حلقة" style="width:50%">
                            </div>
                            <input name="label" id="manual_label" placeholder="اسم النسخة" required>
                            <input type="file" id="subFile" name="subtitleFile" accept=".srt" required onchange="updateLabel(this)">
                            <button type="submit" style="background:#27ae60; color:white; font-weight:bold;">حفظ في السيرفر</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; padding:0 10px;">
                        <h3 style="margin:0;">📁 الترجمات الأخيرة</h3>
                        <button onclick="deleteAllSubtitles()" class="danger-btn">حذف الكل ⚠️</button>
                    </div>
                    <table style="width:100%; border-collapse:collapse; text-align:right;">
                        <thead style="background:#f8f9fa;"><tr><th style="padding:10px;">المحتوى</th><th style="text-align:center;">المصدر</th><th style="text-align:center;">الإجراء</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
            <script>
                function toggleFields(){ document.getElementById('sFields').style.display = document.getElementById('type').value==='series'?'flex':'none'; }
                function updateLabel(input) { if (input.files[0]) document.getElementById('manual_label').value = input.files[0].name.replace('.srt',''); }
                
                let timer;
                function autoSearch() {
                    clearTimeout(timer); const q = document.getElementById('q').value;
                    if(!q || q.length < 2) return;
                    timer = setTimeout(async () => {
                        const res = await fetch('/search-id?q=' + q); const data = await res.json();
                        document.getElementById('r').innerHTML = data.slice(0,8).map(i => \`<div class="search-item" onclick="copyToUpload('\${i.id}', \${i.q === 'TV series'}, event)"><b>\${i.l} (\${i.y || ''})</b> - \${i.id}</div>\`).join('');
                    }, 500);
                }
                function copyToUpload(id, isSeries, event) {
                    document.getElementById('manual_id').value = id;
                    document.getElementById('type').value = isSeries ? 'series' : 'movie';
                    toggleFields(); navigator.clipboard.writeText(id);
                    document.querySelectorAll('.search-item').forEach(el => el.style.background = 'white');
                    event.currentTarget.style.background = '#e8f4fd';
                }
                async function deleteAllSubtitles() {
                    const password = prompt("⚠️ سيتم حذف جميع الترجمات نهائياً.\\nالرجاء إدخال الرقم السري للتأكيد:");
                    if (password === "8182") {
                        if(confirm("هل أنت متأكد فعلاً؟ لا يمكن التراجع!")) {
                            window.location.href = '/delete-all-now?pass=' + password;
                        }
                    } else if (password !== null) {
                        alert("❌ الرقم السري خاطئ!");
                    }
                }
            </script>
        </body></html>`);
    } catch (e) { res.status(500).send("Error"); }
});

/**
 * 9. مسارات التشغيل الخلفي
 */
app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    try {
        let { imdbId, type, season, episode, label } = req.body;
        let cleanId = imdbId.trim();
        let technicalId = type === 'series' ? `${cleanId}:${season || 1}:${episode || 1}` : cleanId;
        const dbFileId = `${technicalId.replace(/:/g, '_')}_manual_${Date.now()}`;
        await Subtitle.findOneAndUpdate({ fileId: dbFileId }, {
            imdbId: technicalId, 
            arabicText: req.file.buffer.toString('utf8'), 
            label, 
            isAI: false
        }, { upsert: true });
        res.redirect('/stats');
    } catch (e) { res.status(500).send(e.message); }
});

app.post("/save-edit", async (req, res) => {
    const hasArFa = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(req.body.newText);
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { 
        arabicText: req.body.newText, 
        isAI: hasArFa && req.body.newText.length > 100 
    });
    res.send("<script>alert('تم الحفظ!'); window.location.href='/stats';</script>");
});

app.get("/delete/:fileId", async (req, res) => { await Subtitle.deleteOne({ fileId: req.params.fileId }); res.redirect('/stats'); });

/**
 * مسار حذف الكل مع التحقق من الرقم السري
 */
app.get("/delete-all-now", async (req, res) => {
    const pass = req.query.pass;
    if (pass === "8182") {
        await Subtitle.deleteMany({});
        res.send("<script>alert('✅ تم مسح القاعدة بالكامل'); window.location.href='/stats';</script>");
    } else {
        res.status(403).send("<h1>❌ غير مصرح لك: الرقم السري خاطئ</h1>");
    }
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

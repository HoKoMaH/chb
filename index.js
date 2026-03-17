const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

const app = express();

/**
 * 1. لاقط الطلبات (Network Logger)
 */
app.use((req, res, next) => {
    if (!req.url.includes('favicon')) {
        console.log(`\n[NETWORK] 📡 ${new Date().toLocaleString('ar-SA')}`);
        console.log(`   - نوع الطلب: ${req.method}`);
        console.log(`   - المسار: ${req.url}`);
    }
    next();
});

/**
 * 2. الاتصال بقاعدة البيانات
 */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] تم الاتصال بنجاح"))
    .catch(err => console.error("❌ [DATABASE] خطأ في الاتصال:", err));

/**
 * 3. إعدادات منع الكاش
 */
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

/**
 * 4. تعريف الموديل
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
 * 5. مسار جلب ملف الـ SRT
 */
app.get("/sub/:fileId.srt", async (req, res) => {
    try {
        const fileId = req.params.fileId.replace('.srt', '');
        const sub = await Subtitle.findOne({ fileId });
        if (sub && sub.arabicText) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sub.label)}.srt"`);
            return res.send(sub.arabicText);
        }
        res.status(404).send("File not found.");
    } catch (e) { res.status(500).send(e.message); }
});

/**
 * 6. لوحة التحكم المطورة مع زر التثبيت
 */
app.get("/stats", async (req, res) => {
    try {
        const totalSubs = await Subtitle.countDocuments();
        const aiSubs = await Subtitle.countDocuments({ isAI: true });
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
        
        // رابط المانيفست الخاص بك (ستريميو يحتاج بروتوكول stremio:// للفتح المباشر)
        const manifestUrl = "chb-gy3n.onrender.com/manifest.json";
        const installUrl = `stremio://${manifestUrl}`;

        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 15px; font-weight: 500;">${sub.label}</td>
                <td style="padding: 15px; text-align: center;">
                    <span style="padding: 4px 10px; border-radius: 20px; font-size: 11px; background: ${sub.isAI ? '#e8f5e9; color: #2e7d32;' : '#fff8e1; color: #f57f17;'}">
                        ${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}
                    </span>
                </td>
                <td style="padding: 15px; color: #7f8c8d; font-size: 12px; text-align: center;">${new Date(sub.createdAt).toLocaleDateString('ar-SA')}</td>
                <td style="padding: 15px; text-align: center;">
                    <a href="/sub/${sub.fileId}.srt" style="text-decoration: none; background: #3498db; color: white; padding: 5px 12px; border-radius: 6px; font-size: 11px;">تحميل ↓</a>
                </td>
            </tr>
        `).join('');

        const html = `
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AR.SA Dashboard</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; padding: 20px; color: #2c3e50; }
                .container { max-width: 900px; margin: auto; }
                .header-section { text-align: center; margin-bottom: 30px; }
                .install-btn { 
                    display: inline-block; background: #8e44ad; color: white; padding: 12px 30px; 
                    border-radius: 50px; text-decoration: none; font-weight: bold; font-size: 16px;
                    box-shadow: 0 4px 15px rgba(142, 68, 173, 0.3); transition: 0.3s; margin-top: 10px;
                }
                .install-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(142, 68, 173, 0.4); background: #9b59b6; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 30px; }
                .card { background: white; padding: 15px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); text-align: center; }
                .card h3 { margin: 0; color: #7f8c8d; font-size: 12px; }
                .card p { font-size: 24px; font-weight: bold; margin: 5px 0; color: #2c3e50; }
                .table-container { background: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); overflow-x: auto; }
                table { width: 100%; border-collapse: collapse; min-width: 500px; }
                th { background: #f8f9fa; padding: 12px; text-align: right; font-size: 13px; color: #34495e; border-bottom: 2px solid #eee; }
                .footer { text-align: center; margin-top: 30px; font-size: 13px; color: #27ae60; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header-section">
                    <h1>📊 لوحة تحكم AR.SA الذكية</h1>
                    <a href="${installUrl}" class="install-btn">+ تثبيت الإضافة في Stremio</a>
                    <p style="font-size: 12px; color: #95a5a6; margin-top: 8px;">(يدعم الفتح المباشر في التطبيق)</p>
                </div>
                
                <div class="stats-grid">
                    <div class="card" style="border-top: 4px solid #3498db;">
                        <h3>إجمالي الترجمات</h3>
                        <p>${totalSubs}</p>
                    </div>
                    <div class="card" style="border-top: 4px solid #2ecc71;">
                        <h3>بواسطة AI 🤖</h3>
                        <p>${aiSubs}</p>
                    </div>
                    <div class="card" style="border-top: 4px solid #f1c40f;">
                        <h3>ترجمات أصلية</h3>
                        <p>${totalSubs - aiSubs}</p>
                    </div>
                </div>

                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>اسم المحتوى</th>
                                <th style="text-align: center;">النوع</th>
                                <th style="text-align: center;">التاريخ</th>
                                <th style="text-align: center;">الإجراء</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows || '<tr><td colspan="4" style="text-align:center; padding:20px;">لا توجد بيانات</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <div class="footer">خادم المزامنة نشط وجاهز 🟢</div>
            </div>
        </body>
        </html>
        `;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) { res.status(500).send("Error"); }
});

/**
 * 7. تشغيل واجهة Stremio
 */
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`🚀 Server is Online: https://chb-gy3n.onrender.com/stats`);
});

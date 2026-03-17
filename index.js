const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

const app = express();

/**
 * 1. الاتصال بقاعدة البيانات MongoDB
 * تأكد من إضافة MONGO_URI في إعدادات Render (Environment Variables)
 */
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

/**
 * 2. إعدادات منع الكاش (Cache Control)
 * هذه الخطوة حاسمة لإجبار Stremio على طلب ترجمة جديدة عند كل فيلم
 */
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

/**
 * 3. تعريف الـ Schema والموديل (Subtitle)
 * تم وضعه هنا وبنفس التنسيق في engine.js لضمان الاستقرار ومنع خطأ MissingSchema
 */
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true }, // المعرف الفريد للنسخة (مثل tt123_v1_smart)
    imdbId: String,
    arabicText: String,
    label: String,
    createdAt: { type: Date, expires: '7d', default: Date.now } // الحذف التلقائي بعد 7 أيام
});

// تعريف الموديل بشكل آمن
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

/**
 * 4. مسار جلب ملف الـ SRT المباشر
 * هذا المسار هو ما يستخدمه مشغل Stremio لتحميل النص وعرضه
 */
app.get("/sub/:fileId.srt", async (req, res) => {
    try {
        const fileId = req.params.fileId.replace('.srt', '');
        console.log(`[SERVER] طلب ملف ترجمة لـ: ${fileId}`);

        const sub = await Subtitle.findOne({ fileId });

        if (sub && sub.arabicText) {
            // إعدادات الـ Headers لضمان قراءة اللغة العربية بشكل صحيح وتجاوز حماية المتصفح
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Disposition', `attachment; filename="${fileId}.srt"`);
            
            return res.send(sub.arabicText);
        }

        console.log(`[SERVER] ⚠️ لم يتم العثور على الترجمة في القاعدة لـ: ${fileId}`);
        res.status(404).send("Subtitle not found in database.");
    } catch (e) {
        console.error(`[SERVER-ERROR] ${e.message}`);
        res.status(500).send("Internal Server Error");
    }
});

/**
 * 5. تشغيل واجهة Stremio Addon
 */
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

/**
 * 6. تشغيل السيرفر على المنفذ المخصص
 */
const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`-----------------------------------------`);
    console.log(`🚀 AR.SA Smart-Sync Server is Live!`);
    console.log(`🔗 Port: ${port}`);
    console.log(`📡 URL: https://chb-gy3n.onrender.com`);
    console.log(`-----------------------------------------`);
});

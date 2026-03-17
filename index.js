const express = require('express');
const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

// 1. إعداد تطبيق Express
const app = express();

// 2. تعريف مسار ملفات الترجمة (هذا هو المفتاح لظهورها في ستريمو)
app.get("/sub/:id.srt", async (req, res) => {
    try {
        const imdbId = req.params.id;
        console.log(`[HTTP] طلب تحميل ملف SRT لـ: ${imdbId}`);

        // جلب البيانات من المونجو (نتأكد من وجود الموديل)
        const SubtitleModel = mongoose.models.Subtitle || mongoose.model('Subtitle', new mongoose.Schema({
            imdbId: String,
            arabicText: String,
            source: String,
            createdAt: { type: Date, expires: '7d', default: Date.now } // كاش لمدة 7 أيام
        }));

        const sub = await SubtitleModel.findOne({ imdbId });

        if (sub && sub.arabicText) {
            // إرسال الهيدرز الصحيحة ليعاملها المشغل كترجمة
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*'); // للسماح لجميع المتصفحات بالوصول
            return res.send(sub.arabicText);
        }

        console.error(`[HTTP-404] الترجمة غير موجودة في القاعدة لـ: ${imdbId}`);
        res.status(404).send("Subtitle not found in cache.");
    } catch (e) {
        console.error(`[HTTP-ERROR] فشل جلب الملف: ${e.message}`);
        res.status(500).send("Internal Server Error");
    }
});

// 3. ربط SDK بـ Express وتشغيل السيرفر
async function startServer() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ متصل بقاعدة بيانات MongoDB بنجاح");

        // دمج مسارات SDK مع تطبيق Express
        serveHTTP(addonInterface, { 
            app, 
            port: process.env.PORT || 10000 
        });

        console.log(`🚀 السيرفر يعمل على المنفذ: ${process.env.PORT || 10000}`);
    } catch (err) {
        console.error("❌ فشل تشغيل السيرفر:", err.message);
        process.exit(1);
    }
}

startServer();
